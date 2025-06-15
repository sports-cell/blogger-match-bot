const axios = require('axios');

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

function extractDataFromPost(postContent, postTitle) {
  const teamData = extractTeamsFromTitle(postTitle);
  if (!teamData) return null;

  const timeMatch = postContent.match(/⏰\s*(\d{1,2}:\d{2}(?:\s*[AP]M)?)/i);
  const matchTime = timeMatch ? timeMatch[1] : null;
  
  const broadcasterMatch = postContent.match(/📺[^<]*?<[^>]*>([^<]+)/i) || 
                          postContent.match(/القناة الناقلة[^<]*?<[^>]*>([^<]+)/i) ||
                          postContent.match(/📺\s*([^<\n]+)/i);
  const broadcaster = broadcasterMatch ? broadcasterMatch[1].trim() : null;
  
  const homeLogoMatch = postContent.match(/<img[^>]*alt="([^"]*)"[^>]*src="([^"]*)"[^>]*>/gi);
  let homeTeamLogo = null;
  let awayTeamLogo = null;
  
  if (homeLogoMatch) {
    homeLogoMatch.forEach(imgTag => {
      const altMatch = imgTag.match(/alt="([^"]*)"/i);
      const srcMatch = imgTag.match(/src="([^"]*)"/i);
      
      if (altMatch && srcMatch) {
        const altText = altMatch[1];
        const src = srcMatch[1];
        
        if (altText.includes(teamData.homeTeam) || teamData.homeTeam.includes(altText)) {
          homeTeamLogo = src;
        } else if (altText.includes(teamData.awayTeam) || teamData.awayTeam.includes(altText)) {
          awayTeamLogo = src;
        }
      }
    });
  }
  
  return {
    ...teamData,
    matchTime,
    broadcaster,
    homeTeamLogo,
    awayTeamLogo
  };
}

function generateMatchReport(matchData, dateCategory, publishedDate) {
  const { homeTeam, awayTeam, league, matchTime, broadcaster, homeTeamLogo, awayTeamLogo } = matchData;
  
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

  const templateVersion = "SPORTLIVE_V2_2025";
  
  const reportContent = `<!-- ${templateVersion} -->
<div class="match-report" style="max-width: 800px; margin: 20px auto; padding: 20px; background: linear-gradient(135deg, #f8f9fa 0%, #ffffff 100%); border-radius: 15px; box-shadow: 0 10px 30px rgba(0,0,0,0.1); font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; border: 1px solid #e9ecef;">
  
  <div class="header" style="text-align: center; margin-bottom: 30px; padding-bottom: 20px; border-bottom: 3px solid ${headerColor};">
    <h1 style="color: #2c3e50; margin: 0; font-size: 28px; font-weight: 700;">
      📊 تقرير المباراة
    </h1>
    <p style="color: #7f8c8d; margin: 10px 0 0 0; font-size: 16px;">${league || 'مباراة كرة قدم'}</p>
  </div>
  
  <div class="teams-container" style="background: white; padding: 30px; border-radius: 12px; margin-bottom: 25px; box-shadow: 0 5px 15px rgba(0,0,0,0.08);">
    <div class="teams-display" style="display: flex; justify-content: space-between; align-items: center; gap: 20px; flex-wrap: wrap;">
      
      <div class="team home-team" style="text-align: center; flex: 1; min-width: 200px;">
        <div class="team-logo" style="width: 80px; height: 80px; border-radius: 50%; margin: 0 auto 15px; display: flex; align-items: center; justify-content: center; box-shadow: 0 5px 15px rgba(0,0,0,0.2); background: white; border: 3px solid ${headerColor}; overflow: hidden;">
          ${homeTeamLogo ? 
            `<img src="${homeTeamLogo}" alt="${homeTeam}" style="width: 70px; height: 70px; object-fit: contain;">` :
            `<span style="color: ${headerColor}; font-size: 28px; font-weight: bold;">⚽</span>`
          }
        </div>
        <h3 style="color: #2c3e50; margin: 0; font-size: 20px; font-weight: 600; word-wrap: break-word;">${homeTeam}</h3>
        <p style="color: #7f8c8d; margin: 5px 0 0 0; font-size: 14px;">الفريق المضيف</p>
      </div>
      
      <div class="vs-section" style="text-align: center; margin: 0 20px;">
        <div style="background: ${headerColor}; color: white; width: 60px; height: 60px; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 10px; font-weight: bold; font-size: 18px; box-shadow: 0 5px 15px rgba(0,0,0,0.2);">
          VS
        </div>
        <p style="color: #95a5a6; margin: 0; font-size: 12px;">${publishedDateFormatted}</p>
      </div>
      
      <div class="team away-team" style="text-align: center; flex: 1; min-width: 200px;">
        <div class="team-logo" style="width: 80px; height: 80px; border-radius: 50%; margin: 0 auto 15px; display: flex; align-items: center; justify-content: center; box-shadow: 0 5px 15px rgba(0,0,0,0.2); background: white; border: 3px solid #e74c3c; overflow: hidden;">
          ${awayTeamLogo ? 
            `<img src="${awayTeamLogo}" alt="${awayTeam}" style="width: 70px; height: 70px; object-fit: contain;">` :
            `<span style="color: #e74c3c; font-size: 28px; font-weight: bold;">⚽</span>`
          }
        </div>
        <h3 style="color: #2c3e50; margin: 0; font-size: 20px; font-weight: 600; word-wrap: break-word;">${awayTeam}</h3>
        <p style="color: #7f8c8d; margin: 5px 0 0 0; font-size: 14px;">الفريق الضيف</p>
      </div>
      
    </div>
  </div>
  
  <div class="status-section" style="text-align: center; margin-bottom: 30px;">
    <div style="display: inline-block; padding: 15px 30px; background: ${headerColor}; color: white; border-radius: 50px; font-weight: 600; font-size: 16px; box-shadow: 0 5px 15px rgba(0,0,0,0.2);">
      ${statusIcon} ${matchStatus}
    </div>
  </div>
  
  <div class="match-info" style="background: white; padding: 25px; border-radius: 12px; margin-bottom: 25px; box-shadow: 0 5px 15px rgba(0,0,0,0.08);">
    <h3 style="color: #2c3e50; margin: 0 0 20px 0; font-size: 20px; display: flex; align-items: center; gap: 10px;">
      <span style="background: ${headerColor}; color: white; width: 35px; height: 35px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 16px;">📋</span>
      معلومات المباراة
    </h3>
    
    <div class="info-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 15px;">
      
      <div class="info-card" style="padding: 20px; background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%); border-radius: 10px; border-left: 4px solid ${headerColor};">
        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
          <span style="font-size: 20px;">🏆</span>
          <strong style="color: #2c3e50; font-size: 16px;">البطولة</strong>
        </div>
        <p style="margin: 0; color: #34495e; font-size: 15px;">${league || 'غير محدد'}</p>
      </div>
      
      <div class="info-card" style="padding: 20px; background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%); border-radius: 10px; border-left: 4px solid ${headerColor};">
        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
          <span style="font-size: 20px;">📅</span>
          <strong style="color: #2c3e50; font-size: 16px;">التاريخ</strong>
        </div>
        <p style="margin: 0; color: #34495e; font-size: 15px;">${publishedDateFormatted}</p>
      </div>
      
      ${matchTime ? `
      <div class="info-card" style="padding: 20px; background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%); border-radius: 10px; border-left: 4px solid ${headerColor};">
        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
          <span style="font-size: 20px;">⏰</span>
          <strong style="color: #2c3e50; font-size: 16px;">التوقيت</strong>
        </div>
        <p style="margin: 0; color: #34495e; font-size: 15px;">${matchTime}</p>
      </div>
      ` : ''}
      
      ${broadcaster ? `
      <div class="info-card" style="padding: 20px; background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%); border-radius: 10px; border-left: 4px solid ${headerColor};">
        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
          <span style="font-size: 20px;">📺</span>
          <strong style="color: #2c3e50; font-size: 16px;">القناة الناقلة</strong>
        </div>
        <p style="margin: 0; color: #34495e; font-size: 15px;">${broadcaster}</p>
      </div>
      ` : ''}
      
    </div>
  </div>
  
  <div class="summary-section" style="background: linear-gradient(135deg, #ffffff 0%, #f8f9fa 100%); padding: 25px; border-radius: 12px; margin-bottom: 25px; border: 1px solid #e9ecef;">
    <h3 style="color: ${headerColor}; margin: 0 0 15px 0; font-size: 20px; display: flex; align-items: center; gap: 10px;">
      <span style="background: ${headerColor}; color: white; width: 35px; height: 35px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 16px;">🎯</span>
      ملخص المباراة
    </h3>
    
    <div style="color: #2c3e50; line-height: 1.8; font-size: 16px;">
      ${dateCategory === 'today' ? 
        `<p style="margin: 0 0 15px 0;"><strong style="color: ${headerColor};">مباراة اليوم</strong> بين فريق <strong>${homeTeam}</strong> وفريق <strong>${awayTeam}</strong> في إطار منافسات <strong>${league || 'البطولة'}</strong>.</p>
         ${matchTime ? `<p style="margin: 0 0 15px 0;">⏰ موعد انطلاق المباراة: <strong style="color: ${headerColor};">${matchTime}</strong></p>` : ''}
         ${broadcaster ? `<p style="margin: 0 0 15px 0;">📺 يمكن متابعة المباراة عبر قناة: <strong style="color: ${headerColor};">${broadcaster}</strong></p>` : ''}
         <p style="margin: 0; padding: 15px; background: #e8f5e8; border-radius: 8px; border-left: 4px solid #27ae60;">سيتم تحديث النتائج والأحداث تلقائياً بعد انتهاء المباراة.</p>` :
        
        dateCategory === 'yesterday' ? 
        `<p style="margin: 0 0 15px 0;"><strong style="color: ${headerColor};">انتهت مباراة الأمس</strong> بين فريق <strong>${homeTeam}</strong> وفريق <strong>${awayTeam}</strong> في إطار منافسات <strong>${league || 'البطولة'}</strong>.</p>
         ${matchTime ? `<p style="margin: 0 0 15px 0;">⏰ أقيمت المباراة في تمام الساعة: <strong style="color: ${headerColor};">${matchTime}</strong></p>` : ''}
         ${broadcaster ? `<p style="margin: 0 0 15px 0;">📺 نقلت المباراة عبر قناة: <strong style="color: ${headerColor};">${broadcaster}</strong></p>` : ''}
         <p style="margin: 0; padding: 15px; background: #fff3cd; border-radius: 8px; border-left: 4px solid #f39c12;">للحصول على النتائج التفصيلية والملخص الكامل، يرجى متابعة القنوات الرياضية المختصة.</p>` :
        
        `<p style="margin: 0 0 15px 0;"><strong style="color: ${headerColor};">مباراة منتهية</strong> بين فريق <strong>${homeTeam}</strong> وفريق <strong>${awayTeam}</strong> في إطار منافسات <strong>${league || 'البطولة'}</strong>.</p>
         <p style="margin: 0 0 15px 0;">📅 أقيمت هذه المباراة بتاريخ: <strong style="color: ${headerColor};">${publishedDateFormatted}</strong></p>
         ${matchTime ? `<p style="margin: 0 0 15px 0;">⏰ في تمام الساعة: <strong style="color: ${headerColor};">${matchTime}</strong></p>` : ''}
         <p style="margin: 0; padding: 15px; background: #f8f9fa; border-radius: 8px; border-left: 4px solid #95a5a6; color: #7f8c8d; font-style: italic;">هذه مباراة من الأرشيف وقد انتهت منذ فترة.</p>`
      }
    </div>
  </div>
  
  <div class="links-section" style="background: white; padding: 25px; border-radius: 12px; box-shadow: 0 5px 15px rgba(0,0,0,0.08);">
    <h3 style="color: #2c3e50; margin: 0 0 20px 0; font-size: 18px; display: flex; align-items: center; gap: 10px;">
      <span style="background: ${headerColor}; color: white; width: 35px; height: 35px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 16px;">🔗</span>
      روابط سريعة
    </h3>
    
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px;">
      <a href="/" style="display: flex; align-items: center; gap: 10px; padding: 15px; background: ${headerColor}; color: white; text-decoration: none; border-radius: 8px; font-weight: 600; transition: all 0.3s ease; box-shadow: 0 3px 10px rgba(0,0,0,0.2);">
        <span style="font-size: 18px;">🏠</span>
        الصفحة الرئيسية
      </a>
      <a href="/" style="display: flex; align-items: center; gap: 10px; padding: 15px; background: #34495e; color: white; text-decoration: none; border-radius: 8px; font-weight: 600; transition: all 0.3s ease; box-shadow: 0 3px 10px rgba(0,0,0,0.2);">
        <span style="font-size: 18px;">⚽</span>
        مباريات أخرى
      </a>
      <a href="/" style="display: flex; align-items: center; gap: 10px; padding: 15px; background: #e74c3c; color: white; text-decoration: none; border-radius: 8px; font-weight: 600; transition: all 0.3s ease; box-shadow: 0 3px 10px rgba(0,0,0,0.2);">
        <span style="font-size: 18px;">📺</span>
        البث المباشر
      </a>
    </div>
  </div>
  
</div>

<style>
.match-report a:hover {
  transform: translateY(-2px);
  box-shadow: 0 5px 15px rgba(0,0,0,0.3) !important;
}

@media (max-width: 768px) {
  .teams-display {
    flex-direction: column !important;
    gap: 30px !important;
  }
  
  .vs-section {
    order: 2;
    margin: 20px 0 !important;
  }
  
  .home-team {
    order: 1;
  }
  
  .away-team {
    order: 3;
  }
  
  .info-grid {
    grid-template-columns: 1fr !important;
  }
  
  .links-section div {
    grid-template-columns: 1fr !important;
  }
}

@media (max-width: 480px) {
  .match-report {
    margin: 10px !important;
    padding: 15px !important;
  }
  
  .teams-container {
    padding: 20px !important;
  }
  
  .match-info, .summary-section, .links-section {
    padding: 20px !important;
  }
}
</style>
`;

  return {
    title: reportTitle,
    content: reportContent
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
        console.log('Waiting 1 second before next page...');
        await new Promise(resolve => setTimeout(resolve, 1000));
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
    console.log('🚀 Starting to convert match posts to clean reports...');
    
    if (!BLOG_ID || !API_KEY || !ACCESS_TOKEN) {
      console.error('❌ Missing required environment variables');
      console.error('Required: BLOG_ID, API_KEY, ACCESS_TOKEN');
      process.exit(1);
    }
    
    console.log('✅ All required environment variables found');
    console.log(`📝 Blog ID: ${BLOG_ID}`);
    
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
    
    for (const post of matchPosts) {
      console.log(`\n📋 Processing: ${post.title}`);
      console.log(`📅 Published: ${new Date(post.published).toLocaleString()}`);
      
      const dateCategory = getDateCategory(post.published);
      console.log(`📂 Date category: ${dateCategory}`);
      
      if (post.title.includes('تقرير المباراة') || post.content.includes('match-report')) {
        if (!post.content.includes('SPORTLIVE_V2_2025')) {
          console.log('🔄 Post is old report template - updating to new design...');
          shouldUpdate = true;
          reason = 'Updating old report to new template';
        } else {
          console.log('✅ Post already has new template, skipping...');
          skippedCount++;
          continue;
        }
      }
      
      if (!shouldUpdate) {
        if (dateCategory === 'older') {
          shouldUpdate = true;
          reason = 'Post is older than yesterday - converting to report';
        } 
        else if (dateCategory === 'yesterday') {
          shouldUpdate = true;
          reason = 'Yesterday\'s match - converting to report';
        } 
        else if (dateCategory === 'today') {
          const postAge = (new Date() - new Date(post.published)) / (1000 * 60 * 60);
          if (postAge > 4) {
            shouldUpdate = true;
            reason = `Today's match is ${postAge.toFixed(1)} hours old - converting to report`;
          } else {
            shouldUpdate = false;
            reason = `Today's match is only ${postAge.toFixed(1)} hours old - keeping as live`;
          }
        }
      }
      
      console.log(`🎯 Decision: ${shouldUpdate ? 'CONVERT TO REPORT' : 'KEEP AS IS'} - ${reason}`);
      
      if (shouldUpdate) {
        const matchData = extractDataFromPost(post.content || '', post.title);
        
        if (matchData) {
          console.log(`🔄 Converting to report: ${matchData.homeTeam} vs ${matchData.awayTeam}`);
          
          const report = generateMatchReport(matchData, dateCategory, post.published);
          
          const success = await updatePost(post.id, report.title, report.content);
          
          if (success) {
            updatedCount++;
            console.log('✅ Post converted to clean report successfully');
          } else {
            errorCount++;
          }
        } else {
          console.log('❌ Could not extract match data from post');
          skippedCount++;
        }
        
        console.log('⏳ Waiting 30 seconds...');
        await new Promise(resolve => setTimeout(resolve, 30000));
      } else {
        skippedCount++;
      }
    }
    
    console.log(`\n🎉 Conversion Complete!`);
    console.log(`   ✅ Converted to reports: ${updatedCount} posts`);
    console.log(`   ⏭️ Skipped (already reports or too recent): ${skippedCount} posts`);
    console.log(`   ❌ Errors: ${errorCount} posts`);
    console.log(`   📊 Total processed: ${updatedCount + skippedCount + errorCount}`);
    
  } catch (error) {
    console.error('💥 Error in updateMatchPosts:', error);
    process.exit(1);
  }
}

updateMatchPosts();
