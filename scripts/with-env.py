"""Load .env as data, never as shell code; preserve explicitly supplied overrides."""

import os, sys
from pathlib import Path
from dotenv import load_dotenv

root = Path(__file__).resolve().parents[1]
load_dotenv(root / ".env", override=False)
os.environ["QUARKMED_ENV_LOADED"] = "1"
os.chdir(root)
os.execvpe(sys.argv[1], sys.argv[1:], os.environ)
