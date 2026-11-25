# TUCC source

`TUCC.user.js` in the repository root is generated from these files. **Install that file, not the ones in here.**

- `build/core.js`: TUCC's core (API engine, key store, tablet, alerts, sandbox).
- `build/build.py`: puts the core and every module into one userscript. `build/credits.py` writes the credits.
- `build/theme/`: TUCC's look for each bundled script.
- `src/`: TUCC's copy of each bundled script. Several are changed from their originals (see `../CREDITS.md` and `../COMPLIANCE.md`); they are not meant to be installed on their own.

To rebuild:

```
python3 build/build.py 0.15.1-tablet TUCC.user.js
```
