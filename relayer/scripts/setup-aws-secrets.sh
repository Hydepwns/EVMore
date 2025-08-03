#!/bin/bash

# Setup script for AWS Secrets Manager for 1inch Fusion+ Cosmos Relayer
# This script creates all necessary secrets in AWS Secrets Manager

set -e

# Configuration
AWS_REGION=${AWS_REGION:-us-west-2}
SECRET_PREFIX="fusion-relayer"

echo "Setting up AWS Secrets Manager for 1inch Fusion+ Cosmos Relayer"
echo "Region: $AWS_REGION"
echo "Secret prefix: $SECRET_PREFIX"

# Function to create or update secret
create_or_update_secret() {
    local secret_name="$1"
    local secret_value="$2"
    local description="$3"
    
    echo "Processing secret: $secret_name"
    
    # Try to create the secret
    if aws secretsmanager create-secret \
        --region "$AWS_REGION" \
        --name "$secret_name" \
        --description "$description" \
        --secret-string "$secret_value" \
        --kms-key-id alias/aws/secretsmanager 2>/dev/null; then
        echo "✓ Created secret: $secret_name"
    else
        # Secret already exists, update it
        if aws secretsmanager update-secret \
            --region "$AWS_REGION" \
            --secret-id "$secret_name" \
            --secret-string "$secret_value" 2>/dev/null; then
            echo "✓ Updated secret: $secret_name"
        else
            echo "✗ Failed to create or update secret: $secret_name"
            return 1
        fi
    fi
}

# Generate secure random values for development (replace with actual values)
generate_random_hex() {
    local length=$1
    openssl rand -hex $length
}

generate_mnemonic() {
    # This is a placeholder - in production, use proper mnemonic generation
    echo "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
}

# Create individual secrets
echo "Creating individual secrets..."

create_or_update_secret \
    "${SECRET_PREFIX}/ethereum-private-key" \
    "0x$(generate_random_hex 32)" \
    "Ethereum private key for signing transactions"

create_or_update_secret \
    "${SECRET_PREFIX}/cosmos-mnemonic" \
    "$(generate_mnemonic)" \
    "Cosmos mnemonic for wallet generation"

create_or_update_secret \
    "${SECRET_PREFIX}/osmosis-mnemonic" \
    "$(generate_mnemonic)" \
    "Osmosis mnemonic for wallet generation"

create_or_update_secret \
    "${SECRET_PREFIX}/postgres-password" \
    "$(generate_random_hex 16)" \
    "PostgreSQL database password"

create_or_update_secret \
    "${SECRET_PREFIX}/redis-password" \
    "$(generate_random_hex 16)" \
    "Redis password (optional)"

create_or_update_secret \
    "${SECRET_PREFIX}/ethereum-rpc-api-key" \
    "your-infura-or-alchemy-api-key" \
    "Ethereum RPC API key (Infura, Alchemy, etc.)"

create_or_update_secret \
    "${SECRET_PREFIX}/metrics-auth-token" \
    "$(generate_random_hex 32)" \
    "Authentication token for metrics endpoints"

create_or_update_secret \
    "${SECRET_PREFIX}/admin-api-token" \
    "$(generate_random_hex 32)" \
    "Authentication token for admin API endpoints"

create_or_update_secret \
    "${SECRET_PREFIX}/encryption-key" \
    "$(generate_random_hex 32)" \
    "Key for encrypting sensitive data"

create_or_update_secret \
    "${SECRET_PREFIX}/jwt-secret" \
    "$(generate_random_hex 32)" \
    "Secret for JWT token signing"

create_or_update_secret \
    "${SECRET_PREFIX}/webhook-secret" \
    "$(generate_random_hex 32)" \
    "Secret for webhook signature verification"

# Create a composite secret with all values (alternative approach)
echo "Creating composite secret..."

COMPOSITE_SECRET=$(cat <<EOF
{
  "ethereum-private-key": "0x$(generate_random_hex 32)",
  "cosmos-mnemonic": "$(generate_mnemonic)",
  "osmosis-mnemonic": "$(generate_mnemonic)",
  "postgres-password": "$(generate_random_hex 16)",
  "redis-password": "$(generate_random_hex 16)",
  "ethereum-rpc-api-key": "your-infura-or-alchemy-api-key",
  "metrics-auth-token": "$(generate_random_hex 32)",
  "admin-api-token": "$(generate_random_hex 32)",
  "encryption-key": "$(generate_random_hex 32)",
  "jwt-secret": "$(generate_random_hex 32)",
  "webhook-secret": "$(generate_random_hex 32)"
}
EOF
)

create_or_update_secret \
    "${SECRET_PREFIX}/all-secrets" \
    "$COMPOSITE_SECRET" \
    "All relayer secrets in a single JSON object"

echo ""
echo "AWS Secrets Manager setup complete!"
echo ""
echo "To use these secrets in your application, set the following environment variables:"
echo "AWS_REGION=$AWS_REGION"
echo "SECRETS_PROVIDER=aws"
echo ""
echo "For individual secrets, reference them as:"
echo "  ${SECRET_PREFIX}/ethereum-private-key"
echo "  ${SECRET_PREFIX}/cosmos-mnemonic"
echo "  etc."
echo ""
echo "For composite secret, reference as:"
echo "  ${SECRET_PREFIX}/all-secrets with key extraction"
echo ""

# Output IAM policy for the relayer
echo "Required IAM policy for the relayer service:"
cat <<EOF
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "secretsmanager:GetSecretValue",
                "secretsmanager:DescribeSecret"
            ],
            "Resource": "arn:aws:secretsmanager:${AWS_REGION}:*:secret:${SECRET_PREFIX}/*"
        },
        {
            "Effect": "Allow",
            "Action": [
                "kms:Decrypt"
            ],
            "Resource": "arn:aws:kms:${AWS_REGION}:*:key/*",
            "Condition": {
                "StringEquals": {
                    "kms:ViaService": "secretsmanager.${AWS_REGION}.amazonaws.com"
                }
            }
        }
    ]
}
EOF

echo ""
echo "⚠️  IMPORTANT: Replace the generated placeholder values with actual secrets!"
echo "⚠️  The generated mnemonics and keys are for development only!"