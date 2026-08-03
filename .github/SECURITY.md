# Sicherheitsrichtlinie

Dies ist ein selbstgehostetes Party-Quiz für den Eigenbetrieb. Sicherheitshinweise
werden trotzdem ernst genommen.

## Schwachstellen melden

Bitte **keine öffentlichen Issues** für Sicherheitslücken öffnen.

Nutze stattdessen **GitHub Private Vulnerability Reporting**:
Tab **„Security" → „Report a vulnerability"**
(<https://github.com/konradthiemann/bilderraetsel/security/advisories/new>).

Ich melde mich in der Regel innerhalb weniger Tage zurück.

## Umgang mit Secrets

- Im Repository liegen **keine** echten Zugangsdaten. Passwörter existieren nur
  zur Laufzeit:
  - `ADMIN_PASSWORD` kommt aus einer Umgebungsvariable (siehe `.env.example`).
  - Raum-Passwörter werden serverseitig mit `scrypt` gehasht gespeichert
    (`data/db.json`, git-ignoriert) – nie im Klartext.
- Solltest du versehentlich ein echtes Secret im Code, in den Logs oder in der
  Git-History finden: **bitte privat melden** (Weg oben), nicht öffentlich posten.
- Rotation ist der eigentliche Fix: Secrets werden in den Railway-**Variables**
  neu gesetzt. Ein History-Purge ist nur zusätzliche Absicherung, ersetzt aber
  keine Rotation.
