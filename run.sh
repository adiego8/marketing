#!/bin/sh
# Marketing Agent — Run Script
# Usage:
#   ./run.sh daily              Trigger a daily run
#   ./run.sh status <run_id>    Check run status
#   ./run.sh detail <run_id>    Full run output
#   ./run.sh list               List recent runs
#   ./run.sh strategy           View current strategy
#   ./run.sh research           Research a company (interactive)
#   ./run.sh images <run_id>    Extract generated images to /tmp/marketing-agent-images/

BASE="http://localhost:8080/api/v1"

case "$1" in
  daily|run)
    echo "Triggering daily run..."
    curl -s -X POST "$BASE/runs/tasks/daily" | python3 -m json.tool
    ;;

  status)
    if [ -z "$2" ]; then echo "Usage: ./run.sh status <run_id>"; exit 1; fi
    curl -s "$BASE/runs/$2" | python3 -c "
import json, sys
data = json.load(sys.stdin)
print(f'Status: {data[\"status\"]}')
print(f'Task: {data[\"task_type\"]}')
print(f'Created: {data[\"created_at\"]}')
if data.get('completed_at'): print(f'Completed: {data[\"completed_at\"]}')
"
    ;;

  detail)
    if [ -z "$2" ]; then echo "Usage: ./run.sh detail <run_id>"; exit 1; fi
    curl -s "$BASE/runs/$2" | python3 -c "
import json, sys
data = json.load(sys.stdin)
print(f'STATUS: {data[\"status\"]}')
output = data.get('output', {})
if output.get('error'):
    print(f'ERROR: {output[\"error\"][:300]}')
    sys.exit(0)

plan = output.get('planning', {})
print(f'\nTOPIC: {plan.get(\"topic\", \"N/A\")}')
print(f'ANGLE: {plan.get(\"angle\", \"N/A\")}')
print(f'REASONING: {plan.get(\"reasoning\", \"N/A\")}')

review = output.get('review', {})
print(f'\nREVIEW: passed on attempt {review.get(\"attempts\", \"?\")}')

pp = output.get('post_production', {})
assets = pp.get('produced_assets', [])
if not assets:
    assets = review.get('approved_assets', output.get('generation', {}).get('assets', []))

print(f'\n=== {len(assets)} ASSETS ===')
for a in assets:
    atype = a.get('type', '?').upper().replace('_', ' ')
    fmt = a.get('format', '')
    print(f'\n--- {atype}{\" | \" + fmt if fmt else \"\"} ---')
    content = a.get('content', '')
    if isinstance(content, list):
        for slide in content:
            if isinstance(slide, dict):
                print(f'  Slide {slide.get(\"slide\", \"?\")}: {slide.get(\"text\", \"\")}')
    else:
        print(f'  {content[:300]}')
    rationale = a.get('rationale', {})
    if rationale.get('why_this_post'):
        print(f'  WHY: {rationale[\"why_this_post\"]}')
    imgs = a.get('generated_images', [])
    if imgs:
        print(f'  IMAGES: {len(imgs)} generated')
"
    ;;

  list)
    echo "Recent runs:"
    curl -s "$BASE/runs?limit=10" | python3 -c "
import json, sys
runs = json.load(sys.stdin)
for r in runs:
    print(f'  {r[\"id\"]}  {r[\"status\"]:10}  {r[\"task_type\"]:8}  {r[\"created_at\"]}')
"
    ;;

  strategy)
    curl -s "$BASE/strategy" | python3 -m json.tool
    ;;

  research)
    echo -n "Company name: "; read name
    echo -n "Website URL: "; read url
    echo -n "Description (optional): "; read desc
    echo "Running research (this takes 1-2 min)..."
    curl -s -X POST "$BASE/onboarding/research" \
      -H "Content-Type: application/json" \
      -d "{\"company_name\": \"$name\", \"website_url\": \"$url\", \"description\": \"$desc\"}" \
      | python3 -m json.tool
    ;;

  images)
    if [ -z "$2" ]; then echo "Usage: ./run.sh images <run_id>"; exit 1; fi
    mkdir -p /tmp/marketing-agent-images
    curl -s "$BASE/runs/$2" | python3 -c "
import base64, json, sys, os
data = json.load(sys.stdin)
pp = data.get('output', {}).get('post_production', {})
assets = pp.get('produced_assets', [])
count = 0
for i, a in enumerate(assets):
    for j, img in enumerate(a.get('generated_images', [])):
        if not img or not img.startswith('data:'): continue
        header, b64 = img.split(',', 1)
        ext = header.split('/')[1].split(';')[0]
        fname = f'{i+1}_{a.get(\"type\",\"unknown\")}_{a.get(\"format\",\"none\")}_v{j+1}.{ext}'
        path = f'/tmp/marketing-agent-images/{fname}'
        with open(path, 'wb') as f:
            f.write(base64.b64decode(b64))
        print(f'  {fname} ({os.path.getsize(path)//1024}KB)')
        count += 1
if count:
    print(f'\n{count} images saved to /tmp/marketing-agent-images/')
    os.system('open /tmp/marketing-agent-images/')
else:
    print('No images found in this run.')
"
    ;;

  *)
    echo "Marketing Agent CLI"
    echo ""
    echo "Usage:"
    echo "  ./run.sh daily              Trigger a daily run"
    echo "  ./run.sh status <run_id>    Check run status"
    echo "  ./run.sh detail <run_id>    Full run output"
    echo "  ./run.sh list               List recent runs"
    echo "  ./run.sh strategy           View current strategy"
    echo "  ./run.sh research           Research a new company"
    echo "  ./run.sh images <run_id>    Extract images from a run"
    ;;
esac
