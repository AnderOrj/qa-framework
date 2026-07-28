#!/bin/bash
cd /Users/anderson/Desktop/claude/qa-framework
/opt/homebrew/bin/node node_modules/.bin/tsx linkedin-job-scraper.ts --once >> /tmp/job-scraper.log 2>&1