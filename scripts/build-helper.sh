#!/bin/sh
# Build the Swift Accessibility helper into bin/axeams-helper.
set -e
cd "$(dirname "$0")/.."
mkdir -p bin
swiftc -O -swift-version 5 helper/TeamsAX.swift -o bin/axeams-helper
echo "built bin/axeams-helper"
