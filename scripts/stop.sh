#!/usr/bin/env bash
pm2 stop arciin-web arciin-api arciin-worker 2>/dev/null && echo "Arciin stopped." || echo "Arciin is not running."
