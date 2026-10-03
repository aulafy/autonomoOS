#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p data/bin
xcrun swiftc native/keychain.swift -o data/bin/gmail-keychain -framework Security
chmod 700 data/bin/gmail-keychain
