#!/bin/sh
# Ensure the preview server is up on :4173, restarting it if the build replaced dist.
if ! curl -s -o /dev/null --max-time 2 http://localhost:4173/; then
  pkill -f "vite preview" 2>/dev/null
  nohup npx vite preview --port 4173 --host > /tmp/majveia-preview.log 2>&1 &
  for i in $(seq 1 20); do
    sleep 0.5
    curl -s -o /dev/null --max-time 2 http://localhost:4173/ && break
  done
fi
