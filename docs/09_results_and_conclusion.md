# 9. Results & Conclusion

## 9.1 What was built
A single web application, started with one command (`python3 server.py --tunnel`), that covers all five requested features:

| Feature | Result |
|---|---|
| 1. Attendance (main) | Rotating HMAC QR + 500 m geofence around Ariel University; one phone per student; Wi-Fi and instructor-approval fallbacks; live roster; photo head count; CSV + live Google Sheets link |
| 2. Comments & suggestions | Live, by category, anonymous option, upvote, resolve |
| 3. Polls | Created in seconds, one vote per student, live results |
| 4. Video ML summary | Upload → **Google Gemini** summary, clickable chapters, takeaways, action items, Q&A *(demo mode without an API key)* |
| 5. Homework deep review | Scores, SOLID, patterns, code smells, side-by-side comparison *(model output simulated)* |

## 9.2 Measured results
| Metric | Result |
|---|---|
| Automated tests | **30 / 30 pass** |
| Load test, 150 simultaneous students | 0 failures · 483 requests in 0.65 s · p95 check-in 248 ms |
| Load test, 300 simultaneous students | 0 failures · 1,084 requests in 1.36 s |
| Idle instructor poll | 41 bytes (versioned polling) |
| Student check-in | 3 steps on one screen, no installation |
| Real iPhone | Works over the tunnel after allowing location for Safari websites |

## 9.3 What we learned
1. **The hard part was the phone, not the code.** Camera and location only work on HTTPS, iPhone Safari distrusts self-signed certificates, and the phone's own settings can silently deny location. Testing on a real device early would have saved several iterations.
2. **Two cheap factors beat one expensive one.** A QR that changes every 20 s (proves you see the screen now) plus GPS (proves you are near) stops screenshot forwarding and remote check-ins without hardware or biometrics.
3. **Fallbacks matter for fairness.** A student whose phone blocks location is still in the room; the Wi-Fi check and instructor approval keep the system strict *and* fair.
4. **Design for the whole lecture hall.** Thread-safety, a larger listen backlog and versioned polling turned a demo that worked for 10 users into one that handles 300 at once.
5. **Layering paid off.** Because the router, services and repository are separate, features such as the device lock, the Wi-Fi check and the head count were added without touching the rest.

## 9.4 Limitations
- Data is **in memory**: restarting the server clears the session (export the CSV first).
- **No authentication**: anyone with the link can open instructor mode; students are identified by device, not by account.
- A student with **two phones** or who wipes all site data gets a new device identity (still needs to be in the room).
- Homework review returns **simulated** model output. Video summaries need the lecturer's own free Gemini API key and internet; uploads through the public tunnel are limited to 100 MB (use localhost for long recordings).
- Photo head count needs **internet** the first time (model download) and is advisory.

## 9.5 Future work
1. University **SSO** login for students and instructors → closes the two-phone gap and protects instructor mode.
2. Connect `CodeReviewService` to the same `GeminiClient` that already powers the video summaries.
3. Persist data in a database (only `DataStore` changes).
4. Push updates with Server-Sent Events instead of polling.
5. Import the real class list (CSV) from the course folder.
