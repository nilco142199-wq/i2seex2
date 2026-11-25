"""
Code analysis for homework submissions – everything here is computed from the student's real files.

  * CodeBundle.from_zip_bytes()  – reads a .zip safely in memory (nothing is extracted to disk):
                                    skips .git / node_modules / venv / binaries, size and count limits
  * CodeBundle.metrics()          – real counts: files, lines, classes, functions, test files, README …
  * CodeBundle.prompt_text()      – file tree + file contents, numbered lines, for the LLM
  * CodeBundle.fingerprint()      – token 5-gram hashes used to compare submissions with each other
  * similarity(a, b)              – Jaccard similarity of two fingerprints (0.0 – 1.0)
  * fetch_github_zip(url)         – downloads a PUBLIC GitHub repository as a zip (github.com only)
"""
import io
import re
import zipfile
import hashlib
import urllib.request
import urllib.error
from typing import Dict, List, Tuple, Set, Any, Optional


class SubmissionError(Exception):
    """A readable problem with the uploaded homework (shown to the student)."""


SOURCE_EXTENSIONS = {
    ".py": "Python", ".java": "Java", ".js": "JavaScript", ".mjs": "JavaScript", ".ts": "TypeScript",
    ".tsx": "TypeScript", ".jsx": "JavaScript", ".c": "C", ".h": "C/C++ header", ".cpp": "C++", ".hpp": "C++",
    ".cc": "C++", ".cs": "C#", ".kt": "Kotlin", ".go": "Go", ".rb": "Ruby", ".php": "PHP", ".swift": "Swift",
    ".rs": "Rust", ".scala": "Scala", ".m": "MATLAB/Obj-C", ".sql": "SQL", ".sh": "Shell",
}
TEXT_EXTENSIONS = set(SOURCE_EXTENSIONS) | {
    ".md", ".txt", ".rst", ".html", ".htm", ".css", ".json", ".yml", ".yaml", ".toml", ".cfg", ".ini",
    ".xml", ".gradle", ".properties", ".mmd", ".puml", ".plantuml", ".csv",
}
TEXT_NAMES = {"makefile", "dockerfile", "requirements.txt", "license", "readme", ".gitignore", "pom.xml"}
SKIP_DIRS = {".git", "node_modules", "venv", ".venv", "env", "__pycache__", "dist", "build", ".idea",
             ".vscode", "target", "bin", "obj", ".gradle", ".next", "coverage", "__MACOSX", ".pytest_cache",
             "vendor", "site-packages"}
SKIP_SUFFIXES = (".min.js", ".min.css", ".lock", "-lock.json", ".map")

MAX_ZIP_BYTES = 30 * 1024 * 1024          # compressed upload
MAX_TOTAL_TEXT = 8 * 1024 * 1024          # all text files together (uncompressed)
MAX_FILE_BYTES = 300 * 1024               # one file
MAX_FILES = 600
PROMPT_CHAR_BUDGET = 700_000              # ≈ 175k tokens – well inside Gemini Flash's context


def _is_test_file(path: str) -> bool:
    p = path.lower()
    name = p.rsplit("/", 1)[-1]
    return ("/test/" in "/" + p or "/tests/" in "/" + p or name.startswith("test_") or name.endswith("_test.py")
            or ".test." in name or ".spec." in name or name.endswith("test.java") or name.endswith("tests.cs"))


class CodeBundle:
    def __init__(self, files: Dict[str, str], skipped: int = 0, truncated_files: int = 0):
        self.files = dict(sorted(files.items()))   # path -> text
        self.skipped = skipped                     # binaries / ignored folders / too big
        self.truncated_files = truncated_files

    # ------------------------------------------------------------------ reading
    @classmethod
    def from_zip_bytes(cls, data: bytes) -> "CodeBundle":
        if len(data) > MAX_ZIP_BYTES:
            raise SubmissionError(f"The zip is larger than {MAX_ZIP_BYTES // (1024 * 1024)} MB. "
                                  "Remove videos, datasets and build folders and try again.")
        try:
            zf = zipfile.ZipFile(io.BytesIO(data))
        except zipfile.BadZipFile:
            raise SubmissionError("This is not a valid .zip file.")
        files: Dict[str, str] = {}
        skipped = total = 0
        with zf:
            infos = [i for i in zf.infolist() if not i.is_dir()]
            if len(infos) > 20000:
                raise SubmissionError("The zip contains too many files.")
            for info in infos:
                path = info.filename.replace("\\", "/")
                parts = [p for p in path.split("/") if p not in ("", ".")]
                if not parts or ".." in parts or path.startswith("/"):
                    skipped += 1
                    continue
                if any(p in SKIP_DIRS for p in parts[:-1]) or parts[-1].startswith("._"):
                    skipped += 1
                    continue
                name = parts[-1].lower()
                ext = ("." + name.rsplit(".", 1)[-1]) if "." in name else ""
                if (ext not in TEXT_EXTENSIONS and name not in TEXT_NAMES) or name.endswith(SKIP_SUFFIXES):
                    skipped += 1
                    continue
                if info.file_size > MAX_FILE_BYTES or len(files) >= MAX_FILES:
                    skipped += 1
                    continue
                if total + info.file_size > MAX_TOTAL_TEXT:
                    raise SubmissionError("The submission has too much text (over 8 MB). "
                                          "Remove generated or data files and try again.")
                with zf.open(info) as fh:
                    raw = fh.read(MAX_FILE_BYTES + 1)   # never trust the declared size (zip bombs)
                if len(raw) > MAX_FILE_BYTES:
                    skipped += 1
                    continue
                if b"\x00" in raw[:4096]:
                    skipped += 1                        # binary that pretends to be text
                    continue
                total += len(raw)
                if total > MAX_TOTAL_TEXT:            # sizes inside a zip can lie – count what was really read
                    raise SubmissionError("The submission has too much text (over 8 MB). "
                                          "Remove generated or data files and try again.")
                files["/".join(parts)] = raw.decode("utf-8", errors="replace")
        files = cls._strip_common_root(files)
        if not any(_ext(p) in SOURCE_EXTENSIONS for p in files):
            raise SubmissionError("No source code was found in the zip (.py, .java, .js, …). "
                                  "Zip the project folder itself, not a shortcut or a video.")
        return cls(files, skipped)

    @staticmethod
    def _strip_common_root(files: Dict[str, str]) -> Dict[str, str]:
        """'my-project/src/a.py' → 'src/a.py' when every file is inside the same top folder."""
        tops = {p.split("/", 1)[0] for p in files}
        if len(tops) == 1 and all("/" in p for p in files):
            return {p.split("/", 1)[1]: t for p, t in files.items()}
        return files

    # ------------------------------------------------------------------ facts
    def metrics(self) -> Dict[str, Any]:
        languages: Dict[str, int] = {}
        lines = code_lines = classes = functions = 0
        test_files = 0
        for path, text in self.files.items():
            ext = _ext(path)
            file_lines = text.splitlines()
            lines += len(file_lines)
            if ext in SOURCE_EXTENSIONS:
                lang = SOURCE_EXTENSIONS[ext]
                languages[lang] = languages.get(lang, 0) + len(file_lines)
                code_lines += sum(1 for ln in file_lines if ln.strip() and not ln.strip().startswith(("#", "//", "*", "/*")))
                classes += len(re.findall(r"^\s*(?:export\s+)?(?:public\s+|abstract\s+|final\s+|private\s+)*"
                                          r"(?:class|interface|enum|record|struct)\s+\w+", text, re.M))
                functions += len(re.findall(r"^\s*(?:async\s+)?def\s+\w+|function\s+\w+\s*\(|"
                                            r"^\s*(?:public|private|protected|static|\s)+[\w<>\[\],\s]+\s+\w+\s*\([^;]*\)\s*\{",
                                            text, re.M))
                if _is_test_file(path):
                    test_files += 1
        lower = [p.lower() for p in self.files]
        return {
            "files": len(self.files),
            "source_files": sum(1 for p in self.files if _ext(p) in SOURCE_EXTENSIONS),
            "lines": lines,
            "code_lines": code_lines,
            "classes": classes,
            "functions": functions,
            "test_files": test_files,
            "has_readme": any(p.rsplit("/", 1)[-1].startswith("readme") for p in lower),
            "doc_files": sum(1 for p in lower if p.endswith((".md", ".rst", ".txt")) and "readme" not in p),
            "diagram_files": sum(1 for p in lower if p.endswith((".mmd", ".puml", ".plantuml")))
                             + sum(1 for p, t in self.files.items() if p.lower().endswith(".md") and "```mermaid" in t),
            "languages": dict(sorted(languages.items(), key=lambda kv: -kv[1])),
            "skipped_files": self.skipped,
        }

    def prompt_text(self, budget: int = PROMPT_CHAR_BUDGET) -> Tuple[str, List[str]]:
        """File tree + contents with line numbers. Returns (text, list of files that were left out)."""
        def priority(path: str) -> Tuple[int, str]:
            p = path.lower()
            if p.rsplit("/", 1)[-1].startswith("readme"):
                return (0, p)
            if _ext(p) in SOURCE_EXTENSIONS and not _is_test_file(p):
                return (1, p)
            if _is_test_file(p):
                return (2, p)
            if p.endswith((".md", ".mmd", ".puml", ".rst", ".txt")):
                return (3, p)
            return (4, p)

        tree = "\n".join(f"- {p} ({len(t.splitlines())} lines)" for p, t in self.files.items())
        out = [f"FILE TREE ({len(self.files)} text files):\n{tree}\n"]
        used = len(out[0])
        omitted: List[str] = []
        for path in sorted(self.files, key=priority):
            numbered = "\n".join(f"{i + 1:>4}| {ln}" for i, ln in enumerate(self.files[path].splitlines()))
            block = f"\n===== FILE: {path} =====\n{numbered}\n"
            if used + len(block) > budget:
                omitted.append(path)
                continue
            out.append(block)
            used += len(block)
        return "".join(out), omitted

    def fingerprint(self) -> Set[int]:
        """Hashes of 5-token windows over the source code (comments, names of strings ignored)."""
        prints: Set[int] = set()
        for path, text in self.files.items():
            if _ext(path) not in SOURCE_EXTENSIONS:
                continue
            tokens = _normalised_tokens(text)
            for i in range(len(tokens) - 4):
                h = int(hashlib.blake2b(" ".join(tokens[i:i + 5]).encode(), digest_size=8).hexdigest(), 16)
                if h % 4 == 0:            # keep 1 in 4 → small, still representative
                    prints.add(h)
        return prints

    def file_fingerprints(self) -> Dict[str, Set[int]]:
        result = {}
        for path, text in self.files.items():
            if _ext(path) in SOURCE_EXTENSIONS:
                tokens = _normalised_tokens(text)
                fp = {int(hashlib.blake2b(" ".join(tokens[i:i + 5]).encode(), digest_size=8).hexdigest(), 16)
                      for i in range(len(tokens) - 4)}
                if len(fp) >= 20:
                    result[path] = fp
        return result


def _ext(path: str) -> str:
    name = path.rsplit("/", 1)[-1].lower()
    return ("." + name.rsplit(".", 1)[-1]) if "." in name else ""


_COMMENT_RE = re.compile(r"#[^\n]*|//[^\n]*|/\*.*?\*/|\"\"\".*?\"\"\"|'''.*?'''", re.S)
_TOKEN_RE = re.compile(r"[A-Za-z_]\w*|\d+|\S")
_KEYWORDS = {"class", "def", "return", "if", "else", "elif", "for", "while", "in", "import", "from", "self",
             "this", "new", "public", "private", "protected", "static", "void", "int", "function", "const",
             "let", "var", "try", "except", "catch", "finally", "with", "as", "raise", "throw", "None", "null",
             "True", "False", "true", "false", "and", "or", "not", "lambda", "yield", "async", "await",
             "interface", "extends", "implements", "super", "pass", "break", "continue", "is", "print"}


def _normalised_tokens(text: str) -> List[str]:
    """Comments removed, identifiers renamed to 'ID' – renaming variables does not hide copying."""
    text = _COMMENT_RE.sub(" ", text)
    out = []
    for tok in _TOKEN_RE.findall(text):
        if tok[0].isalpha() or tok[0] == "_":
            out.append(tok if tok in _KEYWORDS else "ID")
        elif tok[0].isdigit():
            out.append("NUM")
        else:
            out.append(tok)
    return out


def similarity(a: Set[int], b: Set[int]) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def matching_files(a: Dict[str, Set[int]], b: Dict[str, Set[int]], limit: int = 5) -> List[Dict[str, Any]]:
    """Pairs of files (one from each submission) that share the most code."""
    pairs = []
    for pa, fa in a.items():
        for pb, fb in b.items():
            score = len(fa & fb) / min(len(fa), len(fb))   # share of the smaller file found in the other
            if score >= 0.3:
                pairs.append({"file_a": pa, "file_b": pb, "overlap": round(score * 100)})
    pairs.sort(key=lambda p: -p["overlap"])
    return pairs[:limit]


GITHUB_RE = re.compile(r"^(?:https?://)?(?:www\.)?github\.com/([A-Za-z0-9_.-]{1,100})/([A-Za-z0-9_.-]{1,100}?)(?:\.git)?/?$")


def parse_github_url(url: str) -> Tuple[str, str]:
    m = GITHUB_RE.match((url or "").strip())
    if not m:
        raise SubmissionError("Use a public GitHub repository link like https://github.com/user/repo")
    return m.group(1), m.group(2)


def fetch_github_zip(url: str, ssl_context=None, timeout: int = 60) -> Tuple[bytes, str]:
    """Downloads the default branch of a PUBLIC repo. Only github.com is ever contacted (no SSRF)."""
    owner, repo = parse_github_url(url)
    api = f"https://api.github.com/repos/{owner}/{repo}/zipball"
    req = urllib.request.Request(api, headers={"User-Agent": "CS302-Classroom-Suite", "Accept": "application/vnd.github+json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=ssl_context) as resp:
            data = resp.read(MAX_ZIP_BYTES + 1)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            raise SubmissionError("Repository not found – check the link and that the repository is public.")
        if e.code in (403, 429):
            raise SubmissionError("GitHub is limiting downloads right now – upload the project as a .zip instead.")
        raise SubmissionError(f"GitHub returned an error ({e.code}).")
    except urllib.error.URLError as e:
        raise SubmissionError(f"Cannot reach GitHub ({e.reason}). Upload the project as a .zip instead.")
    if len(data) > MAX_ZIP_BYTES:
        raise SubmissionError("The repository is larger than 30 MB – upload a .zip of the code only.")
    return data, f"github.com/{owner}/{repo}"
