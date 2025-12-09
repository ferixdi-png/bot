import fs from 'fs-extra';

async function generatePack() {
  try {
    const reportsDir = './reports';
    const logsDir = './logs';
    
    // Read key files
    let content = '';
    
    // Add status report
    if (fs.existsSync(`${reportsDir}/STATUS.md`)) {
      content += '=== STATUS REPORT ===\n';
      content += fs.readFileSync(`${reportsDir}/STATUS.md`, 'utf8');
      content += '\n\n';
    }
    
    // Add recent sync log (try to read last 200 lines)
    if (fs.existsSync(`${logsDir}/kie-sync.log`)) {
      content += '=== RECENT KIE-SYNC LOG ===\n';
      const syncLogContent = fs.readFileSync(`${logsDir}/kie-sync.log`, 'utf8');
      const syncLines = syncLogContent.split('\n');
      const recentLines = syncLines.slice(Math.max(0, syncLines.length - 200)).join('\n');
      content += recentLines;
      content += '\n\n';
    }
    
    // Add recent bot log
    if (fs.existsSync(`${logsDir}/bot.log`)) {
      content += '=== RECENT BOT LOG ===\n';
      const botLogContent = fs.readFileSync(`${logsDir}/bot.log`, 'utf8');
      const botLines = botLogContent.split('\n');
      const recentLines = botLines.slice(Math.max(0, botLines.length - 200)).join('\n');
      content += recentLines;
      content += '\n\n';
    }
    
    // Add recent validator log
    if (fs.existsSync(`${logsDir}/validator.log`)) {
      content += '=== RECENT VALIDATOR LOG ===\n';
      const validatorLogContent = fs.readFileSync(`${logsDir}/validator.log`, 'utf8');
      const validatorLines = validatorLogContent.split('\n');
      const recentLines = validatorLines.slice(Math.max(0, validatorLines.length - 200)).join('\n');
      content += recentLines;
      content += '\n\n';
    }
    
    // Add errors
    if (fs.existsSync(`${logsDir}/errors.last.txt`)) {
      content += '=== RECENT ERRORS ===\n';
      content += fs.readFileSync(`${logsDir}/errors.last.txt`, 'utf8');
      content += '\n\n';
    }
    
    // Add top broken models (if any)
    if (fs.existsSync('./db/models.json')) {
      const modelsContent = fs.readFileSync('./db/models.json', 'utf8');
      if (modelsContent.trim()) {  // Check if not empty
        const modelsData = JSON.parse(modelsContent);
        const brokenModels = modelsData.filter(m => m.brokenReason);
        if (brokenModels.length > 0) {
          content += '=== TOP BROKEN MODELS ===\n';
          brokenModels.slice(0, 30).forEach((model, i) => {
            content += `${i+1}. ${model.id}: ${model.brokenReason || 'unknown issue'}\n`;
          });
          content += '\n';
        }
      }
    }
    
    // Add model categories summary
    if (fs.existsSync('./db/models.json')) {
      const modelsContent = fs.readFileSync('./db/models.json', 'utf8');
      if (modelsContent.trim()) {  // Check if not empty
        const models = JSON.parse(modelsContent);
        const categories = {};
        models.forEach(model => {
          if (model.category) {
            categories[model.category] = (categories[model.category] || 0) + 1;
          }
        });
        content += '=== MODEL CATEGORIES SUMMARY ===\n';
        content += JSON.stringify(categories, null, 2);
        content += '\n\n';
      }
    }
    
    // Add model count statistics
    if (fs.existsSync('./db/models.json')) {
      const modelsContent = fs.readFileSync('./db/models.json', 'utf8');
      if (modelsContent.trim()) {  // Check if not empty
        const models = JSON.parse(modelsContent);
        const enabled = models.filter(m => m.enabled).length;
        const withSchema = models.filter(m => m.input_schema).length;
        const withPricing = models.filter(m => m.pricing).length;
        
        content += '=== MODEL COUNTS ===\n';
        content += `Total models: ${models.length}\n`;
        content += `Enabled models: ${enabled}\n`;
        content += `Models with schema: ${withSchema}\n`;
        content += `Models with pricing: ${withPricing}\n`;
        content += '\n';
      }
    }
    
    // Add environment variables summary
    content += '=== ENVIRONMENT VARIABLES ===\n';
    const requiredEnv = ['BOT_TOKEN', 'KIE_API_KEY', 'ADMIN_IDS', 'PAYMENT_REQUISITES_TEXT', 'SUPABASE_URL', 'SUPABASE_ANON_KEY'];
    for (const env of requiredEnv) {
      const hasValue = process.env[env] ? 'present' : 'missing';
      content += `${env}: ${hasValue}\n`;
    }
    content += '\n';
    
    // Write to file
    fs.writeFileSync(`${reportsDir}/PACK.txt`, content, 'utf8');
    
    console.log(`[SYSTEM] Generated PACK.txt report with ${content.length} characters`);
    console.log('[SYSTEM] PACK.txt contains:');
    console.log('  - STATUS.md (current system status)');
    console.log('  - Last 200 lines of kie-sync.log');
    console.log('  - Last 200 lines of bot.log'); 
    console.log('  - Last 200 lines of validator.log');
    console.log('  - Full content of errors.last.txt');
    console.log('  - Top 30 broken models (if any)');
    console.log('  - Model categories summary');
    console.log('  - Model counts (total, enabled, with schema/pricing)');
    console.log('  - Environment variables status');
    
  } catch (error) {
    console.error('[SYSTEM] Failed to generate PACK.txt:', error.message);
    console.error('[SYSTEM] Stack:', error.stack);
  }
}

// Run the function
generatePack().catch(console.error);