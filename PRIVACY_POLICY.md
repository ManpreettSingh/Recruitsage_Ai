# Privacy Policy for Recruit Copilot

**Effective Date:** September 29, 2026  
**Last Updated:** September 29, 2026  

Recruit Copilot ("we", "our", or "the extension") is an open-source placement intelligence tool designed to help students research campus placement drives, review past interview questions, and prepare for interviews.

We take student and user privacy extremely seriously. This Privacy Policy describes how Recruit Copilot handles your information.

---

### 1. Data Collection & Usage

* **Job Posting & Notice Data**: When you click "Auto-Fill" or use the side panel on a supported placement portal (e.g., `recruit.thapar.edu`), the extension temporarily parses the text of the job notice currently open in your browser (company name, role, eligibility criteria, CTC, selection rounds) to generate campus prep guides and interview questions.
* **User Queries**: Queries you enter into the doubt-solving chat are transmitted to our secure backend API (`https://13.234.21.16.nip.io`) or Google Gemini to generate answers grounded in verified campus placement data.
* **Locally Stored Settings**: Your preferences (such as Dark/Light theme, Demo Privacy mode, and user-provided Gemini API key) are stored solely on your local device using the browser's `chrome.storage.local` API.

---

### 2. What We Do NOT Collect

* **No Personal Identity Tracking**: We do not collect student roll numbers, passwords, personal emails, or student portal login credentials.
* **No Browsing History Tracking**: The extension only activates on authorized placement portal URLs or when explicitly invoked on the active tab by the user. It does not track your general web browsing history.
* **No Data Selling**: We never sell, rent, monetize, or trade any user data or query content to data brokers or third parties.
* **No Advertising**: Recruit Copilot contains zero third-party ads or tracking beacons.

---

### 3. Permissions Explanation

* **`sidePanel`**: Used solely to display the copilot interface alongside the placement portal without covering the page content.
* **`activeTab`**: Allows the extension to interact with the currently active placement notice tab only when invoked by the user.
* **`scripting`**: Used to safely expand closed accordion sections (e.g. eligibility criteria, salary breakdowns) on placement notices to read complete details.
* **`storage`**: Used to save your UI preferences (dark mode, demo privacy mode) and optional Gemini API keys locally on your device.
* **`host_permissions`**: Restricted strictly to the university placement portal (`https://recruit.thapar.edu/*`) and the secure copilot API (`https://*.nip.io/*`).

---

### 4. Third-Party Services

* **Google Gemini API**: If you use Gemini-powered synthesis, text prompts are processed according to Google's standard API Terms of Service.
* **Upstash Redis**: Used strictly for transient in-flight caching of aggregated public company research and rate limiting to prevent service denial.

---

### 5. Contact & Questions

If you have questions regarding this privacy policy or the Recruit Copilot project, please reach out via GitHub Issues or contact:  
`support@recruitsage.internal` / `arjun.singh@thapar.edu`
