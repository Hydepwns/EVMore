#!/bin/bash

# Setup script for HashiCorp Vault for 1inch Fusion+ Cosmos Relayer
# This script configures Vault and creates all necessary secrets

set -e

# Configuration
VAULT_ADDR=${VAULT_ADDR:-http://localhost:8200}
VAULT_TOKEN=${VAULT_TOKEN:-your_vault_token}
MOUNT_PATH=${VAULT_MOUNT_PATH:-secret}
KV_VERSION=${VAULT_KV_VERSION:-v2}

echo "Setting up HashiCorp Vault for 1inch Fusion+ Cosmos Relayer"
echo "Vault address: $VAULT_ADDR"
echo "Mount path: $MOUNT_PATH"
echo "KV version: $KV_VERSION"

# Set Vault environment
export VAULT_ADDR
export VAULT_TOKEN

# Function to check Vault status
check_vault_status() {
    echo "Checking Vault status..."
    if ! vault status > /dev/null 2>&1; then
        echo "✗ Vault is not accessible at $VAULT_ADDR"
        echo "Make sure Vault is running and VAULT_TOKEN is set correctly"
        exit 1
    fi
    echo "✓ Vault is accessible"
}

# Function to enable KV secrets engine if not already enabled
setup_kv_engine() {
    echo "Setting up KV secrets engine..."
    
    if vault secrets list | grep -q "^${MOUNT_PATH}/"; then
        echo "✓ KV secrets engine already enabled at ${MOUNT_PATH}/"
    else
        if [ "$KV_VERSION" = "v2" ]; then
            vault secrets enable -path="$MOUNT_PATH" -version=2 kv
        else
            vault secrets enable -path="$MOUNT_PATH" kv
        fi
        echo "✓ Enabled KV${KV_VERSION} secrets engine at ${MOUNT_PATH}/"
    fi
}

# Function to create or update secret
create_or_update_secret() {
    local secret_path="$1"
    local secret_data="$2"
    
    echo "Processing secret: $secret_path"
    
    if [ "$KV_VERSION" = "v2" ]; then
        if vault kv put "${MOUNT_PATH}/${secret_path}" $secret_data; then
            echo "✓ Created/updated secret: $secret_path"
        else
            echo "✗ Failed to create/update secret: $secret_path"
            return 1
        fi
    else
        if vault kv put "${MOUNT_PATH}/${secret_path}" $secret_data; then
            echo "✓ Created/updated secret: $secret_path"
        else
            echo "✗ Failed to create/update secret: $secret_path"
            return 1
        fi
    fi
}

# Function to generate secure random values
generate_random_hex() {
    local length=$1
    openssl rand -hex $length
}

generate_mnemonic() {
    # This is a placeholder - in production, use proper mnemonic generation
    echo "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
}

# Main setup
check_vault_status
setup_kv_engine

# Create individual secrets
echo "Creating individual secrets..."

create_or_update_secret \
    "ethereum-private-key" \
    "value=0x$(generate_random_hex 32)"

create_or_update_secret \
    "cosmos-mnemonic" \
    "value=$(generate_mnemonic)"

create_or_update_secret \
    "osmosis-mnemonic" \
    "value=$(generate_mnemonic)"

create_or_update_secret \
    "postgres-password" \
    "value=$(generate_random_hex 16)"

create_or_update_secret \
    "redis-password" \
    "value=$(generate_random_hex 16)"

create_or_update_secret \
    "ethereum-rpc-api-key" \
    "value=your-infura-or-alchemy-api-key"

create_or_update_secret \
    "metrics-auth-token" \
    "value=$(generate_random_hex 32)"

create_or_update_secret \
    "admin-api-token" \
    "value=$(generate_random_hex 32)"

create_or_update_secret \
    "encryption-key" \
    "value=$(generate_random_hex 32)"

create_or_update_secret \
    "jwt-secret" \
    "value=$(generate_random_hex 32)"

create_or_update_secret \
    "webhook-secret" \
    "value=$(generate_random_hex 32)"

# Create a composite secret with all values
echo "Creating composite secret..."

create_or_update_secret \
    "relayer-secrets" \
    "ethereum-private-key=0x$(generate_random_hex 32) \
     cosmos-mnemonic=\"$(generate_mnemonic)\" \
     osmosis-mnemonic=\"$(generate_mnemonic)\" \
     postgres-password=$(generate_random_hex 16) \
     redis-password=$(generate_random_hex 16) \
     ethereum-rpc-api-key=your-infura-or-alchemy-api-key \
     metrics-auth-token=$(generate_random_hex 32) \
     admin-api-token=$(generate_random_hex 32) \
     encryption-key=$(generate_random_hex 32) \
     jwt-secret=$(generate_random_hex 32) \
     webhook-secret=$(generate_random_hex 32)"

# Setup AppRole authentication for the relayer
echo "Setting up AppRole authentication..."

# Enable AppRole auth method if not already enabled
if ! vault auth list | grep -q "^approle/"; then
    vault auth enable approle
    echo "✓ Enabled AppRole authentication"
else
    echo "✓ AppRole authentication already enabled"
fi

# Create policy for the relayer
POLICY_NAME="fusion-relayer-policy"
POLICY_FILE="/tmp/${POLICY_NAME}.hcl"

cat > "$POLICY_FILE" <<EOF
# Policy for 1inch Fusion+ Cosmos Relayer
path "${MOUNT_PATH}/data/*" {
  capabilities = ["read"]
}

path "${MOUNT_PATH}/metadata/*" {
  capabilities = ["read"]
}

# Allow token renewal
path "auth/token/renew-self" {
  capabilities = ["update"]
}

# Allow token lookup
path "auth/token/lookup-self" {
  capabilities = ["read"]
}
EOF

vault policy write "$POLICY_NAME" "$POLICY_FILE"
echo "✓ Created policy: $POLICY_NAME"

# Create AppRole
ROLE_NAME="fusion-relayer"
vault write "auth/approle/role/$ROLE_NAME" \
    token_policies="$POLICY_NAME" \
    token_ttl=1h \
    token_max_ttl=4h \
    bind_secret_id=true

echo "✓ Created AppRole: $ROLE_NAME"

# Get role ID and create secret ID
ROLE_ID=$(vault read -field=role_id "auth/approle/role/$ROLE_NAME/role-id")
SECRET_ID=$(vault write -field=secret_id -f "auth/approle/role/$ROLE_NAME/secret-id")

echo ""
echo "HashiCorp Vault setup complete!"
echo ""
echo "To use these secrets in your application, set the following environment variables:"
echo "VAULT_ADDR=$VAULT_ADDR"
echo "SECRETS_PROVIDER=vault"
echo "VAULT_MOUNT_PATH=$MOUNT_PATH"
echo "VAULT_KV_VERSION=$KV_VERSION"
echo ""
echo "For AppRole authentication:"
echo "VAULT_ROLE_ID=$ROLE_ID"
echo "VAULT_SECRET_ID=$SECRET_ID"
echo ""
echo "For token authentication (alternative):"
echo "VAULT_TOKEN=<your-vault-token>"
echo ""
echo "Individual secrets can be referenced as:"
echo "  ethereum-private-key"
echo "  cosmos-mnemonic"
echo "  etc."
echo ""
echo "Composite secret can be referenced as:"
echo "  relayer-secrets with key extraction"
echo ""

# Clean up temporary files
rm -f "$POLICY_FILE"

# Verification
echo "Verifying setup..."
if [ "$KV_VERSION" = "v2" ]; then
    if vault kv get "${MOUNT_PATH}/ethereum-private-key" > /dev/null 2>&1; then
        echo "✓ Secrets are readable"
    else
        echo "✗ Failed to read secrets"
    fi
else
    if vault kv get "${MOUNT_PATH}/ethereum-private-key" > /dev/null 2>&1; then
        echo "✓ Secrets are readable"
    else
        echo "✗ Failed to read secrets"
    fi
fi

echo ""
echo "⚠️  IMPORTANT: Replace the generated placeholder values with actual secrets!"
echo "⚠️  The generated mnemonics and keys are for development only!"
echo "⚠️  Store the ROLE_ID and SECRET_ID securely!"