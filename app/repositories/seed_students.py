"""
Demo roster: 120 students with Israeli names (deterministic, so every run looks the same).

Everyone starts absent (no invented check-ins). The first ten students keep fixed IDs because the demo data (comments, homework
reviews) and the unit tests refer to them. The rest are generated from common Israeli
first and last names.
"""
import random
from typing import List, Optional, Tuple

DEFAULT_CLASS_SIZE = 120
EMAIL_DOMAIN = "students.example.ac.il"  # deliberately fake domain

# (student_id, name, is_present, check_in_time, method, distance_meters)
FIXED_STUDENTS: List[Tuple[str, str, bool, Optional[str], str, Optional[float]]] = [
    ("s101", "Noa Cohen", False, None, "none", None),
    ("s102", "Yonatan Levi", False, None, "none", None),
    ("s103", "Itai Mizrahi", False, None, "none", None),
    ("s104", "Tamar Peretz", False, None, "none", None),
    ("s105", "Omer Biton", False, None, "none", None),
    ("s106", "Shira Friedman", False, None, "none", None),
    ("s107", "Daniel Avraham", False, None, "none", None),
    ("s108", "Ariel Dahan", False, None, "none", None),
    ("s109", "Maya Azoulay", False, None, "none", None),
    ("s110", "Yousef Haddad", False, None, "none", None),
]

FIRST_NAMES = [
    "Noam", "Lior", "Yael", "Eitan", "Roni", "Amit", "Hila", "Gal", "Nadav", "Michal",
    "Tal", "Yuval", "Adi", "Oren", "Neta", "Ido", "Rotem", "Shir", "Avi", "Dana",
    "Ofir", "Liat", "Matan", "Inbar", "Tomer", "Keren", "Guy", "Moran", "Elad", "Sapir",
    "Asaf", "Hadas", "Ran", "Efrat", "Yair", "Orly", "Itamar", "Talia", "Erez", "Galit",
    "Nir", "Meital", "Ben", "Sivan", "Amir", "Dvir", "Hodaya", "Aviv", "Chen", "Maor",
    "Rina", "Shai", "Liel", "Ohad", "Naama", "Yarden", "Eden", "Alon", "Ayelet", "Barak",
    "Ahmad", "Lina", "Rami", "Nour", "Samer", "Rania", "Kareem", "Aya",
    "Dmitri", "Anna", "Yevgeni", "Katya", "Avraham", "Tsega", "Yonas", "Rahel",
]

LAST_NAMES = [
    "Cohen", "Levi", "Mizrahi", "Peretz", "Biton", "Dahan", "Avraham", "Friedman", "Azoulay",
    "Malka", "Katz", "Yosef", "David", "Amar", "Ohayon", "Hadad", "Gabay", "Ben-David",
    "Shapira", "Elkayam", "Vaknin", "Sasson", "Golan", "Shalom", "Ashkenazi", "Rosenberg",
    "Klein", "Weiss", "Ben-Ami", "Tal", "Carmi", "Segal", "Halevi", "Nachum", "Barak",
    "Mor", "Harari", "Zur", "Edri", "Revivo", "Levy", "Alon", "Ziv", "Shemesh", "Kaplan",
    "Khoury", "Nasser", "Mansour", "Haj", "Ivanov", "Kogan", "Tesfaye", "Mekonen",
]


def _email_for(name: str, student_id: str) -> str:
    local = name.lower().replace(" ", ".").replace("-", "")
    return f"{local}.{student_id}@{EMAIL_DOMAIN}"


def generate_roster(count: int = DEFAULT_CLASS_SIZE, seed: int = 2026):
    """
    Returns a list of dicts ready for the Student constructor.
    Every student starts as NOT checked in – attendance only comes from real check-ins.
    """
    rng = random.Random(seed)
    roster = []
    used_names = set()

    for sid, name, present, c_time, method, dist in FIXED_STUDENTS[:count]:
        used_names.add(name)
        roster.append(dict(student_id=sid, name=name, email=_email_for(name, sid),
                           is_present=present, check_in_time=c_time,
                           check_in_method=method, distance_meters=dist))

    next_number = 111
    while len(roster) < count:
        name = f"{rng.choice(FIRST_NAMES)} {rng.choice(LAST_NAMES)}"
        if name in used_names:
            continue
        used_names.add(name)
        sid = f"s{next_number}"
        next_number += 1
        roster.append(dict(
            student_id=sid,
            name=name,
            email=_email_for(name, sid),
            is_present=False,
            check_in_time=None,
            check_in_method="none",
            distance_meters=None,
        ))
    return roster
