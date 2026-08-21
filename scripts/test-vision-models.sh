#!/bin/bash
# test-vision-models.sh — 测试 dmxapi 上各视觉模型的可用性
# 用法: DMX_KEY=sk-xxx ./scripts/test-vision-models.sh
set -e

KEY="${DMX_KEY:-}"
if [ -z "$KEY" ]; then
  echo "请设置 DMX_KEY 环境变量: DMX_KEY=sk-xxx ./scripts/test-vision-models.sh"
  exit 1
fi

BASE="https://www.dmxapi.cn"
IMG="https://dmxapi.com/111.jpg"
PROMPT="用一句话描述这张图片的内容，直接输出。"

ok=0
fail=0

test_chat_model() {
  local model="$1"
  local label="$2"
  echo -n "[$label] $model ... "
  local resp
  resp=$(curl -s --max-time 30 "$BASE/v1/chat/completions" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $KEY" \
    -d "{
      \"model\": \"$model\",
      \"messages\": [{
        \"role\": \"user\",
        \"content\": [
          {\"type\": \"image_url\", \"image_url\": {\"url\": \"$IMG\"}},
          {\"type\": \"text\", \"text\": \"$PROMPT\"}
        ]
      }]
    }" 2>&1)

  local content
  content=$(echo "$resp" | python3 -c "
import sys,json
try:
  d=json.load(sys.stdin)
  c=d.get('choices',[{}])[0].get('message',{}).get('content','')
  if c: print('OK:', c[:120])
  elif 'error' in d: print('ERR:', json.dumps(d['error'], ensure_ascii=False)[:150])
  else: print('EMPTY:', json.dumps(d, ensure_ascii=False)[:150])
except: print('PARSE_ERR:', sys.stdin.read()[:150])
" 2>&1)

  if echo "$content" | grep -q "^OK:"; then
    echo "$content"
    ok=$((ok+1))
  else
    echo "$content"
    fail=$((fail+1))
  fi
}

test_responses_model() {
  local model="$1"
  local label="$2"
  echo -n "[$label] $model (responses) ... "
  local resp
  resp=$(curl -s --max-time 30 "$BASE/v1/responses" \
    -H "Content-Type: application/json" \
    -H "Authorization: $KEY" \
    -d "{
      \"model\": \"$model\",
      \"input\": [{
        \"role\": \"user\",
        \"content\": [
          {\"type\": \"image_url\", \"image_url\": {\"url\": \"$IMG\"}},
          {\"type\": \"text\", \"text\": \"$PROMPT\"}
        ]
      }],
      \"modalities\": [\"text\"]
    }" 2>&1)

  local content
  content=$(echo "$resp" | python3 -c "
import sys,json
try:
  d=json.load(sys.stdin)
  out=d.get('output',[])
  text=''
  for o in out:
    for c in o.get('content',[]):
      if c.get('type')=='output_text': text+=c.get('text','')
  if text.strip(): print('OK:', text.strip()[:120])
  elif 'error' in d: print('ERR:', json.dumps(d['error'], ensure_ascii=False)[:150])
  else: print('EMPTY:', json.dumps(d, ensure_ascii=False)[:150])
except: print('PARSE_ERR:', sys.stdin.read()[:150])
" 2>&1)

  if echo "$content" | grep -q "^OK:"; then
    echo "$content"
    ok=$((ok+1))
  else
    echo "$content"
    fail=$((fail+1))
  fi
}

echo "=== DMXAPI 视觉模型测试 ==="
echo "测试图片: $IMG"
echo ""

# 现有的两个模型
echo "--- 现有模型 ---"
test_chat_model "doubao-seed-2-0-lite-260215" "现有主"
test_responses_model "qwen3-omni-flash-all" "现有备"
echo ""

# 候选新模型 (全部使用 /v1/chat/completions)
echo "--- 候选新模型 ---"
test_chat_model "gemini-2.5-flash" "Gemini"
test_chat_model "gpt-4o-mini" "GPT4o-mini"
test_chat_model "mimo-v2-omni" "MiMo"
test_chat_model "qwen-vl-ocr-latest" "QwenOCR"
test_chat_model "DeepSeek-OCR" "DSOCR"
test_chat_model "glm-4.1v-flash" "GLM"
echo ""

echo "=== 结果: $ok 成功, $fail 失败 ==="
