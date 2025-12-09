import kieApi from './src/kie.js';
import logger from './src/logger.js';

async function testKieConnection() {
  console.log('Testing KIE API connection...');
  
  try {
    // Test API key authentication
    console.log('Testing API key...');
    const authResult = await kieApi.testApiKey();
    console.log('API Key Test Result:', authResult);
    
    if (authResult.success) {
      console.log('✅ API key is valid and authenticated successfully!');
      console.log('Response data:', JSON.stringify(authResult.response, null, 2));
    } else {
      console.log('❌ API key test failed:', authResult.message);
      
      if (authResult.errorStatus === 401) {
        console.log('🔐 Authentication failed - please check your KIE_API_KEY in .env file');
      } else if (authResult.errorStatus === 403) {
        console.log('🚫 Access forbidden - please check API key permissions');
      } else if (authResult.errorStatus) {
        console.log(`📡 Server responded with status: ${authResult.errorStatus}`);
      }
    }
    
    // Test overall health
    console.log('\nTesting API health...');
    const healthResult = await kieApi.healthCheck();
    console.log('Health Check Result:', healthResult);
    
    if (healthResult.success) {
      console.log('✅ API health check passed!');
    } else {
      console.log('❌ API health check failed:', healthResult.message);
    }
    
  } catch (error) {
    logger.logError('CONNECTION_TEST', 'Error during connection test', {
      error: error.message,
      stack: error.stack
    });
    console.error('💥 Error during connection test:', error.message);
  }
}

// Run the test
testKieConnection().catch(console.error);