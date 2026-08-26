#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Akshayam FP&A Infrastructure Deploy Script
#
# Usage:
#   ./infrastructure/deploy.sh prod
#
# Prerequisites:
#   - AWS CLI configured: aws configure   (region ap-south-1)
#   - Copy params/prod.example.json → params/prod.json and fill in values
#     (SshPublicKey, GithubToken, DbPassword, BasicAuthPassword at minimum)
#
# What it does:
#   prod — Creates/updates a Lightsail instance (nano_2_1, 512 MB) + static IP,
#          with on-box PostgreSQL, nginx + PM2 + certbot, for the Next.js app.
# ─────────────────────────────────────────────────────────────────────────────
set -e

REGION="ap-south-1"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="${1:-prod}"

die() { echo "❌ $*" >&2; exit 1; }
info() { echo ""; echo "──────────────────────────────────────────"; echo "▶  $*"; echo "──────────────────────────────────────────"; }

command -v aws >/dev/null 2>&1 || die "AWS CLI not found. Install: https://aws.amazon.com/cli/"
aws sts get-caller-identity --query "Account" --output text >/dev/null || die "AWS CLI not configured. Run: aws configure"

deploy_stack() {
  local stack_name="$1"
  local template="$2"
  local params_file="$3"

  [ -f "$params_file" ] || die "Params file not found: $params_file — copy the .example.json and fill in your values."

  echo "→ Validating template ..."
  aws cloudformation validate-template --template-body "file://$template" --region "$REGION" >/dev/null

  echo "→ Checking stack: $stack_name ..."
  STACK_STATUS=$(aws cloudformation describe-stacks --stack-name "$stack_name" --region "$REGION" \
    --query "Stacks[0].StackStatus" --output text 2>/dev/null || echo "DOES_NOT_EXIST")

  if [ "$STACK_STATUS" = "ROLLBACK_COMPLETE" ] || [ "$STACK_STATUS" = "ROLLBACK_FAILED" ]; then
    echo "→ Stack is in $STACK_STATUS state — deleting and recreating..."
    aws cloudformation delete-stack --stack-name "$stack_name" --region "$REGION"
    aws cloudformation wait stack-delete-complete --stack-name "$stack_name" --region "$REGION"
    STACK_STATUS="DOES_NOT_EXIST"
  fi

  if [ "$STACK_STATUS" != "DOES_NOT_EXIST" ]; then
    echo "→ Stack exists — updating..."
    aws cloudformation update-stack \
      --stack-name "$stack_name" \
      --template-body "file://$template" \
      --parameters "file://$params_file" \
      --capabilities CAPABILITY_NAMED_IAM \
      --region "$REGION" || {
        CODE=$?
        if aws cloudformation describe-stacks --stack-name "$stack_name" --region "$REGION" \
           --query "Stacks[0].StackStatus" --output text 2>/dev/null | grep -q "COMPLETE"; then
          echo "→ No changes needed."
          return 0
        fi
        return $CODE
      }
    aws cloudformation wait stack-update-complete --stack-name "$stack_name" --region "$REGION"
  else
    echo "→ Stack does not exist — creating..."
    aws cloudformation create-stack \
      --stack-name "$stack_name" \
      --template-body "file://$template" \
      --parameters "file://$params_file" \
      --capabilities CAPABILITY_NAMED_IAM \
      --region "$REGION"
    echo "→ Waiting for creation (bootstrap continues on the box for ~10-15 min after this)..."
    aws cloudformation wait stack-create-complete --stack-name "$stack_name" --region "$REGION"
  fi

  echo "✅ Stack $stack_name done."
  echo ""
  echo "Outputs:"
  aws cloudformation describe-stacks \
    --stack-name "$stack_name" \
    --region "$REGION" \
    --query "Stacks[0].Outputs[*].[OutputKey,OutputValue]" \
    --output table
}

deploy_prod() {
  info "Deploying Production (Lightsail 512 MB + static IP + on-box PostgreSQL + nginx + certbot)"

  deploy_stack "akshayam-prod" "$SCRIPT_DIR/prod.yml" "$SCRIPT_DIR/params/prod.json"

  echo ""
  echo "Next steps:"
  echo "  1. Watch the bootstrap finish (BootstrapLog output) — ~10-15 min on 512 MB."
  echo "  2. Open the AppUrlHttp output; the basic-auth prompt means nginx is live."
  echo "  3. To attach a domain later, follow the AddDomainLater output."
  echo "  4. Redeploys thereafter: ssh in and run /app/deploy.sh"
}

case "$TARGET" in
  prod) deploy_prod ;;
  *) echo "Usage: $0 prod"; exit 1 ;;
esac

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "✅  Infrastructure deploy complete!"
echo "═══════════════════════════════════════════════════════════"
