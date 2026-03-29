#!/bin/sh
export PYTHONPATH=/home/mj/.local/lib/python3.12/site-packages${PYTHONPATH:+:$PYTHONPATH}
exec /usr/bin/python3 -m desloppify.cli "$@"
