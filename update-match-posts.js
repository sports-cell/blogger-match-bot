const axios = require('axios');
const fs = require('fs').promises;

const BLOG_ID = process.env.BLOG_ID;
const API_KEY = process.env.API_KEY;
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;

async function makeAuthenticatedRequest(url, data, method = 'GET') {
  const config = {
    method,
    url,
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      'Content-Type': 'application/json'
    }
  };
  
  if (data && method !== 'GET') {
    config.data = data;
  }
  
  return await axios(config);
}

function getDateCategory(publishedDate) {
  const published = new Date(publishedDate);
  const now = new Date();
  
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const publishedDay = new Date(published.getFullYear(), published.getMonth(), published.getDate());
  
  if (publishedDay.getTime() === today.getTime()) {
    return 'today';
  } else if (publishedDay.getTime() === yesterday.getTime()) {
    return 'yesterday';
  } else if (publishedDay.getTime() < yesterday.getTime()) {
    return 'older';
  } else {
    return 'future';
  }
}

function isMatchFinished(timeString, publishedDate) {
  if (!timeString || timeString === 'TBD' || timeString === 'انتهت') {
    return true;
  }
  
  try {
    const publishedTime = new Date(publishedDate);
    const now = new Date();
    
    const timeParts = timeString.match(/(\d{1,2}):(\d{2})/);
    if (!timeParts) return true;
    
    let matchHour = parseInt(timeParts[1]);
    let matchMinute = parseInt(timeParts[2]);
    
    if (timeString.toLowerCase().includes('pm') && matchHour !== 12) {
      matchHour += 12;
    } else if (timeString.toLowerCase().includes('am') && matchHour === 12) {
      matchHour = 0;
    }
    
    const matchDate = new Date(publishedTime);
    matchDate.setHours(matchHour, matchMinute, 0, 0);
    
    const matchEndTime = new Date(matchDate.getTime() + (3 * 60 * 60 * 1000));
    
    return now > matchEndTime;
  } catch (error) {
    console.error('Error parsing match time:', error);
    return true;
  }
}

async function loadUrlMappings() {
  const path = './match-urls.json';
  
  try {
    const data = await fs.readFile(path, 'utf8');
    const mappings = JSON.parse(data);
    console.log(`Loaded ${Object.keys(mappings).length} URL mappings`);
    return mappings;
  } catch (error) {
    console.log('No URL mappings file found, starting with empty mappings');
    return {};
  }
}

async function saveUrlMappings(mappings) {
  const path = './match-urls.json';
  
  try {
    await fs.writeFile(path, JSON.stringify(mappings, null, 2));
    console.log(`Updated URL mappings saved (${Object.keys(mappings).length} entries)`);
  } catch (error) {
    console.error('Error saving URL mappings:', error);
  }
}

function extractTeamsFromTitle(title) {
  const vsMatch = title.match(/(.+?)\s+(?:vs|ضد)\s+(.+?)(?:\s+-\s+(.+))?$/i);
  if (vsMatch) {
    return {
      homeTeam: vsMatch[1].trim(),
      awayTeam: vsMatch[2].trim(),
      league: vsMatch[3] ? vsMatch[3].trim() : ''
    };
  }
  return null;
}

function extractMatchInfoFromPost(postContent, postTitle) {
  const timeMatch = postContent.match(/⏰\s*(\d{1,2}:\d{2}(?:\s*[AP]M)?)/i);
  const matchTime = timeMatch ? timeMatch[1] : null;
  
  const broadcasterMatch = postContent.match(/📺\s*([^<\n]+)/i);
  const broadcaster = broadcasterMatch ? broadcasterMatch[1].trim() : null;
  
  const leagueMatch = postTitle.match(/(.+?)\s+(?:vs|ضد)\s+(.+?)\s+-\s+(.+)$/i);
  const league = leagueMatch ? leagueMatch[3].trim() : 'مباراة كرة قدم';
  
  const stadiumMatch = postContent.match(/🏟️\s*([^<\n]+)/i);
  const stadium = stadiumMatch ? stadiumMatch[1].trim() : null;
  
  return {
    matchTime,
    broadcaster,
    league,
    stadium
  };
}

function generateStandardMatchReport(teamData, matchInfo, dateCategory, publishedDate) {
  const { homeTeam, awayTeam, league } = teamData;
  const { matchTime, broadcaster, stadium } = matchInfo;
  
  let reportTitle = `تقرير المباراة: ${homeTeam} ضد ${awayTeam}`;
  if (league) {
    reportTitle += ` - ${league}`;
  }
  
  const headerColor = dateCategory === 'today' ? '#27ae60' : 
                     dateCategory === 'yesterday' ? '#f39c12' : '#95a5a6';
  
  let matchStatus = '';
  let statusIcon = '';
  if (dateCategory === 'today') {
    matchStatus = 'مباراة اليوم';
    statusIcon = '🔴';
  } else if (dateCategory === 'yesterday') {
    matchStatus = 'انتهت المباراة';
    statusIcon = '✅';
  } else {
    matchStatus = 'مباراة منتهية';
    statusIcon = '📋';
  }
  
  const publishedDateFormatted = new Date(publishedDate).toLocaleDateString('ar-EG', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  
  const reportContent = `
<div class="match-report" style="max-width: 800px; margin: 20px auto; padding: 20px; background: #f8f9fa; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
  <h2 style="text-align: center; color: #2c3e50; margin-bottom: 30px; border-bottom: 3px solid ${headerColor}; padding-bottom: 15px;">
    📊 تقرير المباراة
  </h2>
  
  <div class="match-header" style="text-align: center; margin-bottom: 30px;">
    <h3 style="color: #34495e; margin-bottom: 20px; font-size: 24px;">${league || 'مباراة كرة قدم'}</h3>
    
    <div class="teams-display" style="display: flex; justify-content: center; align-items: center; gap: 30px; margin: 30px 0; flex-wrap: wrap;">
      <div class="team" style="text-align: center; flex: 1; min-width: 180px; padding: 20px; background: white; border-radius: 10px; box-shadow: 0 1px 5px rgba(0,0,0,0.1);">
        <h4 style="color: #2980b9; margin-bottom: 15px; font-size: 20px; word-wrap: break-word;">${homeTeam}</h4>
        <div class="team-placeholder" style="width: 60px; height: 60px; background: ${headerColor}; border-radius: 50%; margin: 0 auto; display: flex; align-items: center; justify-content: center; color: white; font-size: 24px; font-weight: bold;">⚽</div>
      </div>
      
      <div class="vs-section" style="text-align: center; min-width: 100px;">
        <div class="vs" style="font-size: 28px; color: #7f8c8d; font-weight: bold; margin-bottom: 10px;">VS</div>
        <div class="match-date" style="font-size: 14px; color: #95a5a6;">${publishedDateFormatted}</div>
      </div>
      
      <div class="team" style="text-align: center; flex: 1; min-width: 180px; padding: 20px; background: white; border-radius: 10px; box-shadow: 0 1px 5px rgba(0,0,0,0.1);">
        <h4 style="color: #2980b9; margin-bottom: 15px; font-size: 20px; word-wrap: break-word;">${awayTeam}</h4>
        <div class="team-placeholder" style="width: 60px; height: 60px; background: ${headerColor}; border-radius: 50%; margin: 0 auto; display: flex; align-items: center; justify-content: center; color: white; font-size: 24px; font-weight: bold;">⚽</div>
      </div>
    </div>
  </div>
  
  <div class="match-status" style="text-align: center; margin-bottom: 30px;">
    <span style="display: inline-block; padding: 15px 25px; background: ${headerColor}; color: white; border-radius: 25px; font-weight: bold; font-size: 16px;">
      ${statusIcon} ${matchStatus}
    </span>
  </div>
  
  <div class="match-info" style="background: white; padding: 25px; border-radius: 10px; margin-top: 20px; box-shadow: 0 1px 5px rgba(0,0,0,0.1);">
    <h4 style="color: #2c3e50; margin-bottom: 20px; border-bottom: 2px solid ${headerColor}; padding-bottom: 10px; font-size: 18px;">
      📋 معلومات المباراة
    </h4>
    
    <div class="info-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
      <div class="info-item" style="padding: 15px; background: #f8f9fa; border-radius: 8px; border-left: 4px solid ${headerColor};">
        <strong style="color: #2c3e50;">🏆 البطولة:</strong>
        <div style="margin-top: 5px; color: #34495e;">${league || 'غير محدد'}</div>
      </div>
      
      <div class="info-item" style="padding: 15px; background: #f8f9fa; border-radius: 8px; border-left: 4px solid ${headerColor};">
        <strong style="color: #2c3e50;">📅 التاريخ:</strong>
        <div style="margin-top: 5px; color: #34495e;">${publishedDateFormatted}</div>
      </div>
      
      ${matchTime ? `
      <div class="info-item" style="padding: 15px; background: #f8f9fa; border-radius: 8px; border-left: 4px solid ${headerColor};">
        <strong style="color: #2c3e50;">⏰ التوقيت:</strong>
        <div style="margin-top: 5px; color: #34495e;">${matchTime}</div>
      </div>
      ` : ''}
      
      ${broadcaster ? `
      <div class="info-item" style="padding: 15px; background: #f8f9fa; border-radius: 8px; border-left: 4px solid ${headerColor};">
        <strong style="color: #2c3e50;">📺 القناة الناقلة:</strong>
        <div style="margin-top: 5px; color: #34495e;">${broadcaster}</div>
      </div>
      ` : ''}
      
      ${stadium ? `
      <div class="info-item" style="padding: 15px; background: #f8f9fa; border-radius: 8px; border-left: 4px solid ${headerColor}; grid-column: 1 / -1;">
        <strong style="color: #2c3e50;">🏟️ الملعب:</strong>
        <div style="margin-top: 5px; color: #34495e;">${stadium}</div>
      </div>
      ` : ''}
      
      <div class="info-item" style="padding: 15px; background: #f8f9fa; border-radius: 8px; border-left: 4px solid ${headerColor}; grid-column: 1 / -1;">
        <strong style="color: #2c3e50;">🔄 آخر تحديث:</strong>
        <div style="margin-top: 5px; color: #34495e;">${new Date().toLocaleString('ar-EG')}</div>
      </div>
    </div>
  </div>
  
  <div class="match-summary" style="margin-top: 25px; padding: 20px; background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%); border-radius: 10px; border: 1px solid #dee2e6;">
    <h4 style="color: ${headerColor}; margin-bottom: 15px; font-size: 18px;">🎯 معلومات عامة</h4>
    <div style="color: #2c3e50; line-height: 1.8; font-size: 15px;">
      ${dateCategory === 'today' ? 
        `<p><strong>مباراة اليوم</strong> بين ${homeTeam} و ${awayTeam} في إطار ${league || 'البطولة'}.</p>
         ${matchTime ? `<p>موعد انطلاق المباراة: <strong>${matchTime}</strong></p>` : ''}
         ${broadcaster ? `<p>يمكن متابعة المباراة عبر: <strong>${broadcaster}</strong></p>` : ''}
         <p>سيتم تحديث النتائج والأحداث تلقائياً بعد انتهاء المباراة.</p>` :
        
        dateCategory === 'yesterday' ? 
        `<p>انتهت مباراة الأمس بين <strong>${homeTeam}</strong> و <strong>${awayTeam}</strong> في إطار ${league || 'البطولة'}.</p>
         ${matchTime ? `<p>أقيمت المباراة في تمام الساعة: <strong>${matchTime}</strong></p>` : ''}
         ${broadcaster ? `<p>نقلت المباراة عبر: <strong>${broadcaster}</strong></p>` : ''}
         <p>للحصول على النتائج التفصيلية والملخص، يرجى متابعة القنوات الرياضية المختصة.</p>` :
        
        `<p>مباراة منتهية بين <strong>${homeTeam}</strong> و <strong>${awayTeam}</strong> في إطار ${league || 'البطولة'}.</p>
         <p>أقيمت هذه المباراة بتاريخ: <strong>${publishedDateFormatted}</strong></p>
         ${matchTime ? `<p>في تمام الساعة: <strong>${matchTime}</strong></p>` : ''}
         <p style="color: #7f8c8d; font-style: italic;">هذه مباراة من الأرشيف وقد لا تظهر في البطاقات الحالية.</p>`
      }
    </div>
  </div>
  
  <div class="links-section" style="margin-top: 25px; padding: 20px; background: white; border-radius: 10px; box-shadow: 0 1px 5px rgba(0,0,0,0.1);">
    <h4 style="color: #2c3e50; margin-bottom: 15px; font-size: 18px;">🔗 روابط مفيدة</h4>
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px;">
      <a href="/" style="display: block; padding: 12px; background: ${headerColor}; color: white; text-decoration: none; border-radius: 6px; text-align: center; font-weight: bold; transition: opacity 0.3s;">
        🏠 الصفحة الرئيسية
      </a>
      <a href="/" style="display: block; padding: 12px; background: #34495e; color: white; text-decoration: none; border-radius: 6px; text-align: center; font-weight: bold; transition: opacity 0.3s;">
        ⚽ مباريات أخرى
      </a>
      <a href="/" style="display: block; padding: 12px; background: #e74c3c; color: white; text-decoration: none; border-radius: 6px; text-align: center; font-weight: bold; transition: opacity 0.3s;">
        📺 البث المباشر
      </a>
    </div>
  </div>
  
  <div class="disclaimer" style="margin-top: 25px; padding: 15px; background: #fff3cd; border: 1px solid #ffeaa7; border-radius: 8px; font-size: 13px; color: #856404;">
    <strong>🔔 ملاحظة مهمة:</strong> هذا تقرير تلقائي يتم إنشاؤه لأرشفة معلومات المباراة. للحصول على النتائج الدقيقة والتفاصيل الكاملة، يرجى متابعة القنوات الرياضية الرسمية أو المواقع المتخصصة.
  </div>
</div>

<style>
.match-report a:hover {
  opacity: 0.8;
}

@media (max-width: 768px) {
  .teams-display {
    flex-direction: column !important;
    gap: 20px !important;
  }
  
  .info-grid {
    grid-template-columns: 1fr !important;
  }
  
  .links-section div {
    grid-template-columns: 1fr !important;
  }
}
</style>
`;

  return {
    title: reportTitle,
    content: reportContent
  };
}

// Missing function: generateMatchReport - Adding a placeholder implementation
function generateMatchReport(matchData, originalTitle, dateCategory) {
  // Extract team information from original title if not in matchData
  const teamData = extractTeamsFromTitle(originalTitle) || {
    homeTeam: matchData.homeTeam || 'الفريق الأول',
    awayTeam: matchData.awayTeam || 'الفريق الثاني',
    league: matchData.league || 'مباراة كرة قدم'
  };
  
  // Create match info object
  const matchInfo = {
    matchTime: matchData.matchTime || null,
    broadcaster: matchData.broadcaster || null,
    stadium: matchData.stadium || null,
    league: matchData.league || teamData.league
  };
  
  // Use the standard report generator
  return generateStandardMatchReport(teamData, matchInfo, dateCategory, new Date().toISOString());
}

// Missing function: searchMatchOnKooraLiveTV - Adding a placeholder implementation
async function searchMatchOnKooraLiveTV(homeTeam, awayTeam, dateCategory) {
  // This is a placeholder implementation since the original function wasn't provided
  console.log(`Searching for match: ${homeTeam} vs ${awayTeam} (${dateCategory})`);
  
  // Return a basic structure indicating no data found
  return {
    found: false,
    homeTeam: homeTeam,
    awayTeam: awayTeam,
    homeScore: 0,
    awayScore: 0,
    status: 'المباراة انتهت',
    league: 'مباراة كرة قدم',
    finalScore: 'غير متوفر'
  };
}

async function updatePost(postId, newTitle, newContent) {
  try {
    const updateData = {
      title: newTitle,
      content: newContent
    };
    
    const url = `https://www.googleapis.com/blogger/v3/blogs/${BLOG_ID}/posts/${postId}`;
    await makeAuthenticatedRequest(url, updateData, 'PUT');
    console.log(`✅ Successfully updated post ${postId}`);
    return true;
  } catch (error) {
    console.error(`❌ Error updating post ${postId}:`, error.response?.data || error.message);
    return false;
  }
}

async function getAllBlogPosts(maxResults = 500) {
  try {
    console.log(`Fetching all blog posts (max: ${maxResults})`);
    
    let allPosts = [];
    let pageToken = '';
    let pageCount = 0;
    
    do {
      pageCount++;
      let url = `https://www.googleapis.com/blogger/v3/blogs/${BLOG_ID}/posts?maxResults=50&key=${API_KEY}`;
      
      if (pageToken) {
        url += `&pageToken=${pageToken}`;
      }
      
      console.log(`Fetching page ${pageCount}...`);
      const response = await axios.get(url);
      
      if (response.data.items) {
        allPosts = allPosts.concat(response.data.items);
        console.log(`Added ${response.data.items.length} posts (total: ${allPosts.length})`);
      }
      
      pageToken = response.data.nextPageToken;
      
      if (allPosts.length >= maxResults) {
        allPosts = allPosts.slice(0, maxResults);
        break;
      }
      
      if (pageToken) {
        console.log('Waiting 2 seconds before next page...');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      
    } while (pageToken && allPosts.length < maxResults);
    
    console.log(`Total posts fetched: ${allPosts.length}`);
    return allPosts;
  } catch (error) {
    console.error('Error fetching blog posts:', error.response?.data || error.message);
    return [];
  }
}

function isMatchPost(postTitle) {
  const matchPatterns = [
    /vs\s/i,
    /\s-\s.*(?:league|cup|championship|liga|premier|serie|bundesliga|ligue)/i,
    /مباراة/,
    /ضد/
  ];
  
  return matchPatterns.some(pattern => pattern.test(postTitle));
}

async function updateMatchPosts() {
  try {
    console.log('🚀 Starting to update match posts with reports...');
    
    if (!BLOG_ID || !API_KEY || !ACCESS_TOKEN) {
      console.error('❌ Missing required environment variables');
      console.error('Required: BLOG_ID, API_KEY, ACCESS_TOKEN');
      process.exit(1);
    }
    
    console.log('✅ All required environment variables found');
    console.log(`📝 Blog ID: ${BLOG_ID}`);
    
    let urlMappings = await loadUrlMappings();
    let allPosts = await getAllBlogPosts();
    
    if (allPosts.length === 0) {
      console.log('❌ No posts found to process');
      return;
    }
    
    const matchPosts = allPosts.filter(post => isMatchPost(post.title));
    console.log(`🔍 Found ${matchPosts.length} match posts out of ${allPosts.length} total posts`);
    
    let updatedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    const cleanedMappings = { ...urlMappings };
    
    for (const post of matchPosts) {
      console.log(`\n📋 Processing: ${post.title}`);
      console.log(`📅 Published: ${new Date(post.published).toLocaleString()}`);
      
      const dateCategory = getDateCategory(post.published);
      console.log(`📂 Date category: ${dateCategory}`);
      
      if (post.title.includes('تقرير المباراة') || post.content.includes('match-report')) {
        console.log('✅ Post is already a match report, skipping...');
        skippedCount++;
        continue;
      }
      
      const postAge = (new Date() - new Date(post.published)) / (1000 * 60 * 60);
      console.log(`⏰ Post age: ${postAge.toFixed(1)} hours`);
      
      let shouldUpdate = false;
      let reason = '';
      
      if (dateCategory === 'older') {
        shouldUpdate = true;
        reason = 'Post is older than yesterday';
      } else if (dateCategory === 'yesterday') {
        shouldUpdate = true;
        reason = 'Yesterday\'s match should be updated to report';
      } else if (dateCategory === 'today') {
        const timeMatch = post.content?.match(/⏰\s*(\d{1,2}:\d{2}(?:\s*[AP]M)?)/i);
        const matchTime = timeMatch ? timeMatch[1] : null;
        
        if (matchTime) {
          const isFinished = isMatchFinished(matchTime, post.published);
          if (isFinished) {
            shouldUpdate = true;
            reason = `Today's match at ${matchTime} has finished`;
          } else {
            reason = `Today's match at ${matchTime} is still current/future`;
          }
        } else {
          if (postAge > 6) {
            shouldUpdate = true;
            reason = `No match time found and post is ${postAge.toFixed(1)} hours old (>6h)`;
          } else {
            reason = `No match time found but post is only ${postAge.toFixed(1)} hours old (<6h)`;
          }
        }
      }
      
      console.log(`🎯 Decision: ${shouldUpdate ? 'UPDATE' : 'KEEP'} - ${reason}`);
      
      if (shouldUpdate) {
        const teamData = extractTeamsFromTitle(post.title);
        
        if (teamData) {
          console.log(`🔍 Searching for match: ${teamData.homeTeam} vs ${teamData.awayTeam}`);
          
          const matchData = await searchMatchOnKooraLiveTV(teamData.homeTeam, teamData.awayTeam, dateCategory);
          
          let report;
          if (matchData.found) {
            console.log('✅ Match data found, generating report...');
            report = generateMatchReport(matchData, post.title, dateCategory);
          } else {
            console.log('⚠️ Match data not found, creating basic report...');
            
            const basicMatchData = {
              homeTeam: teamData.homeTeam,
              awayTeam: teamData.awayTeam,
              homeScore: 0,
              awayScore: 0,
              status: 'المباراة انتهت',
              league: teamData.league,
              finalScore: 'غير متوفر',
              found: false
            };
            
            report = generateMatchReport(basicMatchData, post.title, dateCategory);
          }
          
          const success = await updatePost(post.id, report.title, report.content);
          
          if (success) {
            updatedCount++;
            
            if (dateCategory === 'older') {
              const mappingKey = Object.keys(cleanedMappings).find(key => 
                cleanedMappings[key].url === post.url
              );
              
              if (mappingKey) {
                console.log(`🗑️ Removing URL mapping for older post: ${cleanedMappings[mappingKey].readableKey}`);
                delete cleanedMappings[mappingKey];
              }
            }
            
            console.log('✅ Post updated successfully with match report');
          } else {
            errorCount++;
          }
        } else {
          console.log('❌ Could not extract team names from title');
          errorCount++;
        }
        
        console.log('⏳ Waiting 10 seconds to respect rate limits...');
        await new Promise(resolve => setTimeout(resolve, 10000));
      } else {
        skippedCount++;
      }
    }
    
    if (Object.keys(cleanedMappings).length !== Object.keys(urlMappings).length) {
      console.log(`💾 Saving cleaned URL mappings (removed ${Object.keys(urlMappings).length - Object.keys(cleanedMappings).length} old entries)`);
      await saveUrlMappings(cleanedMappings);
    }
    
    console.log(`\n🎉 Update Complete!`);
    console.log(`   ✅ Updated: ${updatedCount} posts`);
    console.log(`   ⏭️ Skipped: ${skippedCount} posts`);
    console.log(`   ❌ Errors: ${errorCount} posts`);
    console.log(`   📊 Total processed: ${updatedCount + skippedCount + errorCount}`);
    console.log(`   🗑️ Cleaned mappings: ${Object.keys(urlMappings).length - Object.keys(cleanedMappings).length} entries`);
    
  } catch (error) {
    console.error('💥 Error in updateMatchPosts:', error);
    process.exit(1);
  }
}

updateMatchPosts();
