# Campus Historical Data Instructions

Place your real Thapar placement records in this directory:

1. **Placement Statistics (`data/campus_placements.json`)**:
   - You can copy your JSON file here and rename it to `campus_placements.json`.
   - See `campus_placements_template.json` for reference fields (company name, year, CTC, rounds, selection counts).

2. **Campus Question Bank (`data/question_bank.csv`)**:
   - Export your Google Sheet as a CSV (`File` -> `Download` -> `Comma-separated values (.csv)`) and save it here as `question_bank.csv`.
   - Key fields supported: Company Name, Year, Round (OA / Technical / HR), Topic (DSA, OS, DBMS, HR), Question details.

> The system automatically handles company name variations (e.g. "D. E. Shaw" vs "DE Shaw India") via fuzzy matching and alias normalization.
