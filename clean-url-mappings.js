const axios = require('axios');
const fs = require('fs').promises;

const BLOG_ID = process.env.BLOG_ID;
const API_KEY = process.env.API_KEY;

async function loadUrlMappings() {
  const path = './match-urls.json';
  
  try {
    const data = await fs.readFile(path, 'utf8');
    const mappings = JSON.parse(data);
    console.log(`📂 Loaded ${Object.keys(mappings).length} URL mappings`);
    return mappings;
  } catch (error) {
    console.log('ℹ️ No URL mappings file found');
    return {};
  }
}

async function saveUrlMappings(mappings) {
  const path = './match-urls.json';
  
  try {
    await fs.writeFile(path, JSON.stringify(mappings, null, 2));
    console.log(`💾 Updated URL mappings saved (${Object.keys(mappings).length} entries)`);
  } catch (error) {
    console.error('❌ Error saving URL mappings:', error);
  }
}

function getDateCategory(publishedDate) {
  const published = new Date(publishedDate);
  const now = new Date();
  
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const twoDaysAgo = new Date(today.getTime() - 48 * 60 * 60 * 1000);
  const publishedDay = new Date(published.getFullYear(), published.getMonth(), published.getDate());
  
  if (publishedDay.getTime() === today.getTime()) {
    return 'today';
  } else if (publishedDay.getTime() === yesterday.getTime()) {
    return 'yesterday';
  } else if (publishedDay.getTime() <= twoDaysAgo.getTime()) {
    return 'older';
  } else {
    return 'future';
  }
}

async function checkPostExists(postUrl) {
  try {
    const searchUrl = `https://www.googleapis.com/blogger/v3/blogs/${BLOG_ID}/posts?key=${API_KEY}`;
    const response = await axios.get(searchUrl);
    
    if (response.data.items && response.data.items.length > 0) {
      const exactMatch = response.data.items.find(post => post.url === postUrl);
      
      if (exactMatch) {
        const dateCategory = getDateCategory(exactMatch.published);
        return { 
          exists: true, 
          post: exactMatch,
          dateCategory,
          isReport: exactMatch.title.includes('تقرير المباراة') || exactMatch.content.includes('match-report')
        };
      }
    }
    
    return { exists: false, reason: 'Post not found in blog' };
  } catch (error) {
    console.warn(`⚠️ Error checking post ${postUrl}:`, error.message);
    return { exists: false, reason: error.message };
  }
}

async function cleanUrlMappings() {
  try {
    console.log('🧹 Starting URL mappings cleanup...');
    
    if (!BLOG_ID || !API_KEY) {
      console.error('❌ Missing required environment variables for cleanup');
      console.error('Required: BLOG_ID, API_KEY');
      return;
    }
    
    const urlMappings = await loadUrlMappings();
    
    if (Object.keys(urlMappings).length === 0) {
      console.log('ℹ️ No URL mappings to clean');
      return;
    }
    
    console.log(`🔍 Checking ${Object.keys(urlMappings).length} URL mappings...`);
    
    const cleanedMappings = {};
    let removedCount = 0;
    let keptCount = 0;
    let errorCount = 0;
    
    for (const [key, mapping] of Object.entries(urlMappings)) {
      console.log(`\n📋 Checking: ${mapping.readableKey || key}`);
      
      const checkResult = await checkPostExists(mapping.url);
      
      if (checkResult.exists) {
        console.log(`✅ Post exists - Category: ${checkResult.dateCategory}, Is Report: ${checkResult.isReport}`);
        
        if (checkResult.dateCategory === 'older') {
          removedCount++;
          console.log(`🗑️ Removing mapping (older than 2 days)`);
        } else {
          cleanedMappings[key] = mapping;
          keptCount++;
          console.log(`📌 Keeping mapping (${checkResult.dateCategory})`);
        }
      } else {
        removedCount++;
        console.log(`🗑️ Removing mapping: ${checkResult.reason}`);
      }
      
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    if (removedCount > 0) {
      await saveUrlMappings(cleanedMappings);
      console.log(`\n🎉 Cleanup Complete!`);
      console.log(`   📌 Kept: ${keptCount} mappings`);
      console.log(`   🗑️ Removed: ${removedCount} mappings`);
      console.log(`   ❌ Errors: ${errorCount} mappings`);
      console.log(`   📊 Final count: ${Object.keys(cleanedMappings).length} mappings`);
    } else {
      console.log('\n✅ No mappings needed to be removed');
    }
    
  } catch (error) {
    console.error('💥 Error in cleanUrlMappings:', error);
    process.exit(1);
  }
}

cleanUrlMappings();
