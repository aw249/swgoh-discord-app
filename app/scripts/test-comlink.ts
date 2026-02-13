#!/usr/bin/env ts-node
/**
 * Test script to verify Comlink integration is working
 * 
 * Usage: npx ts-node scripts/test-comlink.ts
 * Or: npm run test:comlink (if added to package.json)
 */

import { ComlinkClient } from '../src/integrations/comlink/comlinkClient';
import { loadEnv } from '../src/utils/env';

async function testComlink(): Promise<void> {
  console.log('🔍 Testing Comlink Integration...\n');

  // Load environment variables
  try {
    loadEnv();
    console.log('✅ Environment variables loaded');
  } catch (error) {
    console.error('❌ Failed to load environment variables:', error);
    process.exit(1);
  }

  // Get Comlink URL from environment or use default
  const comlinkUrl = process.env.COMLINK_URL || 'http://localhost:3200';
  console.log(`📍 Comlink URL: ${comlinkUrl}\n`);

  // Create Comlink client
  const client = new ComlinkClient({
    url: comlinkUrl,
  });

  // Test 1: Check if Comlink is ready
  console.log('Test 1: Checking if Comlink is ready...');
  try {
    const isReady = await client.isReady();
    if (isReady) {
      console.log('✅ Comlink is ready and responding\n');
    } else {
      console.log('❌ Comlink is not ready (service may be starting up)\n');
    }
  } catch (error: any) {
    console.log(`❌ Failed to check Comlink readiness: ${error.message}\n`);
    console.log('💡 Make sure Comlink is running:');
    console.log('   - If using Docker: docker ps | grep comlink');
    console.log('   - If using PM2: pm2 list | grep comlink');
    console.log('   - If using npm: npm run comlink\n');
  }

  // Test 2: Get metadata
  console.log('Test 2: Fetching metadata from Comlink...');
  try {
    const metadata = await client.getMetadata();
    console.log('✅ Successfully fetched metadata');
    console.log('   Metadata keys:', Object.keys(metadata as object).join(', '));
    console.log('');
  } catch (error: any) {
    console.log(`❌ Failed to fetch metadata: ${error.message}\n`);
  }

  // Test 3: Test player lookup (if you have a test ally code)
  const testAllyCode = process.env.TEST_ALLY_CODE;
  if (testAllyCode) {
    console.log(`Test 3: Testing player lookup for ally code ${testAllyCode}...`);
    try {
      const player = await client.getPlayer(testAllyCode);
      console.log('✅ Successfully fetched player data');
      console.log(`   Player Name: ${(player as any).name || 'Unknown'}`);
      console.log(`   Player Level: ${(player as any).level || 'Unknown'}`);
      console.log(`   Galactic Power: ${(player as any).galacticPower || 'Unknown'}`);
      console.log('');
    } catch (error: any) {
      console.log(`❌ Failed to fetch player data: ${error.message}\n`);
    }
  } else {
    console.log('Test 3: Skipped (set TEST_ALLY_CODE env var to test player lookup)\n');
  }

  // Summary
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 Test Summary:');
  console.log('   If all tests passed, Comlink is working correctly!');
  console.log('   If tests failed, check:');
  console.log('   1. Comlink service is running');
  console.log('   2. Comlink URL is correct (check .env file)');
  console.log('   3. Network connectivity to Comlink');
  console.log('   4. Comlink logs for errors');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

// Run the test
testComlink().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

