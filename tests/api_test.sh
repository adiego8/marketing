#!/usr/bin/env bash
#
# API Regression Tests
# Curls every endpoint and validates responses.
# Usage: ./tests/api_test.sh
#

set -euo pipefail

BASE="http://localhost:8080"
API="$BASE/api/v1"
PASS=0
FAIL=0
ERRORS=""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# --- Helpers ---

assert_status() {
  local test_name="$1"
  local expected="$2"
  local actual="$3"
  local body="$4"

  if [ "$actual" -eq "$expected" ]; then
    echo -e "  ${GREEN}PASS${NC} $test_name (HTTP $actual)"
    PASS=$((PASS + 1))
  else
    echo -e "  ${RED}FAIL${NC} $test_name — expected $expected, got $actual"
    echo "       Body: $(echo "$body" | head -c 200)"
    FAIL=$((FAIL + 1))
    ERRORS="$ERRORS\n  - $test_name (expected $expected, got $actual)"
  fi
}

# Curl wrapper: returns "STATUS_CODE\nBODY"
api() {
  local method="$1"
  local path="$2"
  local data="${3:-}"

  if [ -n "$data" ]; then
    curl -s -w "\n%{http_code}" -X "$method" "$API$path" \
      -H "Content-Type: application/json" \
      -d "$data"
  else
    curl -s -w "\n%{http_code}" -X "$method" "$API$path" \
      -H "Content-Type: application/json"
  fi
}

parse_status() { echo "$1" | tail -1; }
parse_body()   { echo "$1" | sed '$d'; }
json_field()   { echo "$1" | python3 -c "import sys,json; print(json.load(sys.stdin)$2)" 2>/dev/null || echo ""; }

# --- Wait for API ---

echo -e "${YELLOW}Waiting for API...${NC}"
for i in $(seq 1 30); do
  if curl -s "$BASE/health" | grep -q "ok"; then
    echo -e "${GREEN}API is ready${NC}"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo -e "${RED}API not ready after 30s${NC}"
    exit 1
  fi
  sleep 1
done

echo ""

# =============================================================================
# CLIENT TESTS
# =============================================================================
echo -e "${YELLOW}=== Client CRUD ===${NC}"

# List clients
resp=$(api GET /clients)
assert_status "List clients" 200 "$(parse_status "$resp")" "$(parse_body "$resp")"

# Create client
resp=$(api POST /clients '{"name":"Test Client","website_url":"https://test.com","contact_email":"test@test.com"}')
assert_status "Create client" 201 "$(parse_status "$resp")" "$(parse_body "$resp")"
CLIENT_ID=$(json_field "$(parse_body "$resp")" "['id']")
echo "  Created client: $CLIENT_ID"

# Get client
resp=$(api GET "/clients/$CLIENT_ID")
assert_status "Get client" 200 "$(parse_status "$resp")" "$(parse_body "$resp")"

# Update client
resp=$(api PATCH "/clients/$CLIENT_ID" '{"name":"Updated Client","description":"Updated desc"}')
assert_status "Update client" 200 "$(parse_status "$resp")" "$(parse_body "$resp")"

# List clients with search
resp=$(api GET "/clients?search=Updated")
assert_status "Search clients" 200 "$(parse_status "$resp")" "$(parse_body "$resp")"

# List clients with status filter
resp=$(api GET "/clients?status=active")
assert_status "Filter clients by status" 200 "$(parse_status "$resp")" "$(parse_body "$resp")"

# Create second client for isolation tests
resp=$(api POST /clients '{"name":"Other Client"}')
OTHER_CLIENT_ID=$(json_field "$(parse_body "$resp")" "['id']")
echo "  Created other client: $OTHER_CLIENT_ID"

echo ""

# =============================================================================
# STRATEGY TESTS (client-scoped)
# =============================================================================
echo -e "${YELLOW}=== Strategy (client-scoped) ===${NC}"

# Get strategy (should be 404 for new client)
resp=$(api GET "/clients/$CLIENT_ID/strategy")
assert_status "Get strategy (none yet)" 404 "$(parse_status "$resp")" "$(parse_body "$resp")"

# Create strategy via PUT
resp=$(api PUT "/clients/$CLIENT_ID/strategy" '{
  "business_name":"Test Business",
  "icp":{"description":"Test ICP"},
  "voice":{"tone":"friendly"},
  "positioning":{},
  "messaging":{"tagline":"Test tagline"},
  "goals":{"primary":"awareness"},
  "content_quota":{"weekly":{"post":3,"hook":2}}
}')
assert_status "Create strategy" 200 "$(parse_status "$resp")" "$(parse_body "$resp")"

# Get strategy
resp=$(api GET "/clients/$CLIENT_ID/strategy")
assert_status "Get strategy" 200 "$(parse_status "$resp")" "$(parse_body "$resp")"

# Update strategy
resp=$(api PUT "/clients/$CLIENT_ID/strategy" '{"business_name":"Updated Business"}')
assert_status "Update strategy" 200 "$(parse_status "$resp")" "$(parse_body "$resp")"

# Strategy isolation — other client should have no strategy
resp=$(api GET "/clients/$OTHER_CLIENT_ID/strategy")
assert_status "Strategy isolation (other client 404)" 404 "$(parse_status "$resp")" "$(parse_body "$resp")"

echo ""

# =============================================================================
# CAMPAIGN TESTS (client-scoped)
# =============================================================================
echo -e "${YELLOW}=== Campaigns (client-scoped) ===${NC}"

# List campaigns (empty)
resp=$(api GET "/clients/$CLIENT_ID/campaigns")
assert_status "List campaigns (empty)" 200 "$(parse_status "$resp")" "$(parse_body "$resp")"

# Create campaign
resp=$(api POST "/clients/$CLIENT_ID/campaigns" '{"title":"Test Campaign","description":"A test"}')
assert_status "Create campaign" 201 "$(parse_status "$resp")" "$(parse_body "$resp")"
CAMPAIGN_ID=$(json_field "$(parse_body "$resp")" "['id']")
echo "  Created campaign: $CAMPAIGN_ID"

# Get campaign
resp=$(api GET "/clients/$CLIENT_ID/campaigns/$CAMPAIGN_ID")
assert_status "Get campaign" 200 "$(parse_status "$resp")" "$(parse_body "$resp")"

# Update campaign (content plan)
resp=$(api PATCH "/clients/$CLIENT_ID/campaigns/$CAMPAIGN_ID" '{
  "content_plan":{"breakdown":[{"type":"post","count":3},{"type":"hook","count":2}]}
}')
assert_status "Update campaign content plan" 200 "$(parse_status "$resp")" "$(parse_body "$resp")"

# Campaign lifecycle: review → accept → complete
resp=$(api POST "/clients/$CLIENT_ID/campaigns/$CAMPAIGN_ID/review" '{"comment":"Looks good"}')
assert_status "Review campaign" 200 "$(parse_status "$resp")" "$(parse_body "$resp")"

resp=$(api POST "/clients/$CLIENT_ID/campaigns/$CAMPAIGN_ID/accept")
assert_status "Accept campaign" 200 "$(parse_status "$resp")" "$(parse_body "$resp")"

resp=$(api POST "/clients/$CLIENT_ID/campaigns/$CAMPAIGN_ID/complete")
assert_status "Complete campaign" 200 "$(parse_status "$resp")" "$(parse_body "$resp")"

# Create + reject campaign
resp=$(api POST "/clients/$CLIENT_ID/campaigns" '{"title":"Reject Me"}')
REJECT_ID=$(json_field "$(parse_body "$resp")" "['id']")
resp=$(api POST "/clients/$CLIENT_ID/campaigns/$REJECT_ID/reject" '{"reason":"Not aligned"}')
assert_status "Reject campaign" 200 "$(parse_status "$resp")" "$(parse_body "$resp")"

# Campaign isolation
resp=$(api GET "/clients/$OTHER_CLIENT_ID/campaigns")
body=$(parse_body "$resp")
count=$(echo "$body" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "-1")
if [ "$count" = "0" ]; then
  echo -e "  ${GREEN}PASS${NC} Campaign isolation (other client has 0 campaigns)"
  PASS=$((PASS + 1))
else
  echo -e "  ${RED}FAIL${NC} Campaign isolation — other client has $count campaigns"
  FAIL=$((FAIL + 1))
fi

# Delete campaign
resp=$(api DELETE "/clients/$CLIENT_ID/campaigns/$REJECT_ID")
assert_status "Delete campaign" 200 "$(parse_status "$resp")" "$(parse_body "$resp")"

echo ""

# =============================================================================
# ASSET TESTS (client-scoped)
# =============================================================================
echo -e "${YELLOW}=== Assets (client-scoped) ===${NC}"

# List assets (empty)
resp=$(api GET "/clients/$CLIENT_ID/assets")
assert_status "List assets (empty)" 200 "$(parse_status "$resp")" "$(parse_body "$resp")"

# Create asset
resp=$(api POST "/clients/$CLIENT_ID/assets" '{"type":"post","content":{"text":"Hello world"},"rating":4}')
assert_status "Create asset" 201 "$(parse_status "$resp")" "$(parse_body "$resp")"
ASSET_ID=$(json_field "$(parse_body "$resp")" "['id']")
echo "  Created asset: $ASSET_ID"

# Get asset
resp=$(api GET "/clients/$CLIENT_ID/assets/$ASSET_ID")
assert_status "Get asset" 200 "$(parse_status "$resp")" "$(parse_body "$resp")"

# Update asset
resp=$(api PATCH "/clients/$CLIENT_ID/assets/$ASSET_ID" '{"rating":5}')
assert_status "Update asset rating" 200 "$(parse_status "$resp")" "$(parse_body "$resp")"

# Create asset with campaign
resp=$(api POST "/clients/$CLIENT_ID/campaigns" '{"title":"Asset Campaign"}')
ASSET_CAMP_ID=$(json_field "$(parse_body "$resp")" "['id']")
resp=$(api POST "/clients/$CLIENT_ID/assets" "{\"type\":\"hook\",\"content\":{\"text\":\"Hooked\"},\"campaign_id\":\"$ASSET_CAMP_ID\"}")
assert_status "Create asset with campaign" 201 "$(parse_status "$resp")" "$(parse_body "$resp")"

# Filter by type
resp=$(api GET "/clients/$CLIENT_ID/assets?type=post")
assert_status "Filter assets by type" 200 "$(parse_status "$resp")" "$(parse_body "$resp")"

# Filter by campaign
resp=$(api GET "/clients/$CLIENT_ID/assets?campaign_id=$ASSET_CAMP_ID")
assert_status "Filter assets by campaign" 200 "$(parse_status "$resp")" "$(parse_body "$resp")"

# Asset isolation
resp=$(api GET "/clients/$OTHER_CLIENT_ID/assets")
body=$(parse_body "$resp")
count=$(echo "$body" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "-1")
if [ "$count" = "0" ]; then
  echo -e "  ${GREEN}PASS${NC} Asset isolation (other client has 0 assets)"
  PASS=$((PASS + 1))
else
  echo -e "  ${RED}FAIL${NC} Asset isolation — other client has $count assets"
  FAIL=$((FAIL + 1))
fi

# Delete asset
resp=$(api DELETE "/clients/$CLIENT_ID/assets/$ASSET_ID")
assert_status "Delete asset" 200 "$(parse_status "$resp")" "$(parse_body "$resp")"

echo ""

# =============================================================================
# CROSS-CLIENT ISOLATION
# =============================================================================
echo -e "${YELLOW}=== Cross-client isolation ===${NC}"

# Try to get client A's campaign from client B
resp=$(api GET "/clients/$OTHER_CLIENT_ID/campaigns/$CAMPAIGN_ID")
assert_status "Cannot access other client's campaign" 404 "$(parse_status "$resp")" "$(parse_body "$resp")"

# Archived client should reject requests
resp=$(api DELETE "/clients/$OTHER_CLIENT_ID")
assert_status "Archive client" 200 "$(parse_status "$resp")" "$(parse_body "$resp")"

resp=$(api GET "/clients/$OTHER_CLIENT_ID/strategy")
assert_status "Archived client rejects requests" 400 "$(parse_status "$resp")" "$(parse_body "$resp")"

# Nonexistent client
resp=$(api GET "/clients/99999999-9999-9999-9999-999999999999/strategy")
assert_status "Nonexistent client returns 404" 404 "$(parse_status "$resp")" "$(parse_body "$resp")"

echo ""

# =============================================================================
# MEMORY TESTS (client-scoped)
# =============================================================================
echo -e "${YELLOW}=== Memory (client-scoped) ===${NC}"

resp=$(api GET "/clients/$CLIENT_ID/memory/summaries")
assert_status "List memory summaries" 200 "$(parse_status "$resp")" "$(parse_body "$resp")"

echo ""

# =============================================================================
# TASKS (agency-level)
# =============================================================================
echo -e "${YELLOW}=== Tasks (agency-level) ===${NC}"

resp=$(api GET /tasks)
assert_status "List tasks" 200 "$(parse_status "$resp")" "$(parse_body "$resp")"

echo ""

# =============================================================================
# HEALTH CHECK
# =============================================================================
echo -e "${YELLOW}=== Health ===${NC}"

resp=$(curl -s -w "\n%{http_code}" "$BASE/health")
assert_status "Health check" 200 "$(parse_status "$resp")" "$(parse_body "$resp")"

echo ""

# =============================================================================
# SUMMARY
# =============================================================================
TOTAL=$((PASS + FAIL))
echo "=================================="
echo -e "  ${GREEN}PASSED: $PASS${NC}  ${RED}FAILED: $FAIL${NC}  TOTAL: $TOTAL"
echo "=================================="

if [ "$FAIL" -gt 0 ]; then
  echo -e "\n${RED}Failed tests:${ERRORS}${NC}"
  exit 1
fi

echo -e "\n${GREEN}All tests passed!${NC}"
