# Privacy

SkillDock runs entirely inside your browser.

- **Stored data:** only your saved skill list and the most recent run report,
  in `chrome.storage.local` on your machine. Nothing else is stored.
- **Network:** the extension makes no network requests of any kind. There is
  no analytics, no telemetry, no error reporting, no remote configuration,
  and no remotely hosted code.
- **Page access:** the content script runs only in the tab where you click
  "Fill skills" (via the `activeTab` permission) and interacts only with the
  Skills autocomplete field it detects or the field you manually pick. It
  does not read, log, or transmit other application fields or answers.
- **Logging:** disabled by default. The optional debug logging inside the fill
  engine prints locator scores, engine states, and timeout reasons to the
  page console only — never applicant information or application answers.
- **Removal:** uninstalling the extension deletes its stored data.

This project is an independent productivity tool and is not affiliated with,
endorsed by, or sponsored by Workday, Inc. Workday is a trademark of its
respective owner.
