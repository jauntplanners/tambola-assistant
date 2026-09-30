"""Print a bcrypt hash for APP_PASSWORD_HASH.  Usage: python -m app.hashpw"""

import getpass

import bcrypt

pw = getpass.getpass("Password: ")
if pw != getpass.getpass("Again: "):
    raise SystemExit("Passwords do not match.")
print(bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode())
