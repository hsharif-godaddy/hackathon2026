#!/bin/sh

exec mitmweb -s gocode-random-error.py --mode reverse:https://caas-gocode-prod.caas-prod.prod.onkatana.net
