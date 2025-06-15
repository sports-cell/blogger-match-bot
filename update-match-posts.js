const axios = require('axios');
const cheerio = require('cheerio');

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

function decodeMatchUrl(encodedUrl) {
  try {
    const decodedUrl = decodeURIComponent(encodedUrl);
    console.log(`🔓 Decoded URL: ${decodedUrl}`);
    
    const urlParts = decodedUrl.split('/').pop(); 
    
    const patterns = [
      /(.+?)-و-(.+?)-في/,  
      /(.+?)-vs-(.+?)-في/,  
      /(.+?)-ضد-(.+?)-في/,
      /(.+?)-و-(.+?)$/,    
      /(.+?)-vs-(.+?)$/,  
      /(.+?)-ضد-(.+?)$/   
    ];
    
    for (const pattern of patterns) {
      const match = urlParts.match(pattern);
      if (match) {
        const homeTeam = match[1].replace(/-/g, ' ').trim();
        const awayTeam = match[2].replace(/-/g, ' ').trim();
        
        console.log(`✅ Extracted teams: ${homeTeam} vs ${awayTeam}`);
        
        return {
          homeTeam,
          awayTeam,
          title: `${homeTeam} ضد ${awayTeam}`,
          found: true
        };
      }
    }
    
    console.log(`❌ Could not extract teams from: ${urlParts}`);
    return { found: false };
    
  } catch (error) {
    console.error(`❌ Error decoding URL: ${error.message}`);
    return { found: false };
  }
}

async function parseKooraLiveTVHTML() {
  try {
    console.log('🔍 Parsing HTML DOM from KooraLiveTV yesterday page...');
    
    const response = await axios.get('https://www.kooralivetv.com/matches-yesterday/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 15000
    });
    
    const $ = cheerio.load(response.data);
    const matchCards = [];
    
    console.log('📋 Looking for match URLs...');
    
    $('a').each((index, element) => {
      const link = $(element);
      const href = link.attr('href');
      
      if (href && href.includes('/matches/') && href.includes('%')) {
        let fullHref = href;
        if (!fullHref.startsWith('http')) {
          fullHref = 'https://www.kooralivetv.com' + fullHref;
        }
        
        console.log(`🔗 Found encoded match URL: ${fullHref}`);
        
        const teamData = decodeMatchUrl(fullHref);
        
        if (teamData.found) {
          matchCards.push({
            homeTeam: teamData.homeTeam,
            awayTeam: teamData.awayTeam,
            title: teamData.title,
            reportUrl: fullHref
          });
        }
      }
    });
    
    const uniqueCards = [];
    const seen = new Set();
    
    matchCards.forEach(card => {
      const key = `${card.homeTeam}-${card.awayTeam}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueCards.push(card);
      }
    });
    
    console.log(`\n📊 Total unique match cards found: ${uniqueCards.length}`);
    uniqueCards.forEach(card => {
      console.log(`   ⚽ ${card.homeTeam} vs ${card.awayTeam}`);
      console.log(`   🔗 URL: ${card.reportUrl}`);
    });
    
    return uniqueCards;
    
  } catch (error) {
    console.error('❌ Error parsing KooraLiveTV HTML:', error.message);
    return [];
  }
}

async function scrapeMatchReportFromLink(reportUrl) {
  try {
    console.log(`\n📖 Scraping match report from: ${reportUrl}`);
    
    const response = await axios.get(reportUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 15000
    });
    
    const $ = cheerio.load(response.data);
    
    const matchReport = {
      homeTeam: '',
      awayTeam: '',
      homeScore: 0,
      awayScore: 0,
      homeTeamLogo: '',
      awayTeamLogo: '',
      homeLineup: [],
      awayLineup: [],
      events: [],
      league: '',
      stadium: '',
      time: '',
      found: false
    };
    
    console.log('🏠 Looking for team logos...');
    const logos = [];
    $('img').each((index, element) => {
      const img = $(element);
      const src = img.attr('src') || img.attr('data-src');
      const alt = img.attr('alt') || '';
      
      if (src && src.includes('wp-content/uploads') && 
          (alt.includes('تحت') || alt.includes('U19') || alt.includes('U20') || alt.includes('U21') ||
           src.includes('/2025/') || src.includes('/202'))) {
        logos.push({ src, alt });
        console.log(`   🖼️ Found logo: ${alt} -> ${src}`);
      }
    });
    
    if (logos.length >= 2) {
      matchReport.homeTeamLogo = logos[0].src;
      matchReport.awayTeamLogo = logos[1].src;
      matchReport.homeTeam = matchReport.homeTeam || logos[0].alt;
      matchReport.awayTeam = matchReport.awayTeam || logos[1].alt;
    }
    
    const pageTitle = $('title').text();
    console.log(`📄 Page title: ${pageTitle}`);
    
    if (pageTitle.includes('ضد') || pageTitle.includes('vs')) {
      const titleMatch = pageTitle.match(/(.+?)\s+(?:ضد|vs)\s+(.+?)(?:\s|$)/i);
      if (titleMatch) {
        matchReport.homeTeam = matchReport.homeTeam || titleMatch[1].trim();
        matchReport.awayTeam = matchReport.awayTeam || titleMatch[2].trim();
        console.log(`📄 Teams from title: ${matchReport.homeTeam} vs ${matchReport.awayTeam}`);
      }
    }
    
    console.log('⚽ Looking for match score...');
    const bodyText = $('body').text();
    
    const scorePatterns = [
      /(\d+)\s*[-:]\s*(\d+)/g,
      /نتيجة.*?(\d+)\s*[-:]\s*(\d+)/g,
      /score.*?(\d+)\s*[-:]\s*(\d+)/gi
    ];
    
    for (const pattern of scorePatterns) {
      let scoreMatch;
      while ((scoreMatch = pattern.exec(bodyText)) !== null) {
        const score1 = parseInt(scoreMatch[1]);
        const score2 = parseInt(scoreMatch[2]);
        
        if (score1 >= 0 && score2 >= 0 && score1 <= 20 && score2 <= 20) {
          matchReport.homeScore = score1;
          matchReport.awayScore = score2;
          matchReport.found = true;
          console.log(`   ⚽ Found score: ${score1}-${score2}`);
          break;
        }
      }
      if (matchReport.found) break;
    }
    
    console.log('📊 Looking for match events...');
    
    const eventPatterns = [
      /(\d+)['′]\s*([^0-9\n\r]{3,50})/g,
      /(\d+)\s*دقيقة\s*([^0-9\n\r]{3,50})/g,
      /الدقيقة\s*(\d+)\s*([^0-9\n\r]{3,50})/g
    ];
    
    for (const pattern of eventPatterns) {
      let eventMatch;
      while ((eventMatch = pattern.exec(bodyText)) !== null) {
        const minute = eventMatch[1];
        const eventText = eventMatch[2].trim();
        
        if (eventText.length > 3 && eventText.length < 100) {
          let eventType = 'حدث';
          let eventIcon = '⚽';
          
          if (eventText.includes('هدف') || eventText.includes('goal')) {
            eventType = 'هدف';
            eventIcon = '⚽';
          } else if (eventText.includes('صفراء') || eventText.includes('yellow')) {
            eventType = 'بطاقة صفراء';
            eventIcon = '🟨';
          } else if (eventText.includes('حمراء') || eventText.includes('red')) {
            eventType = 'بطاقة حمراء';
            eventIcon = '🟥';
          } else if (eventText.includes('تبديل') || eventText.includes('substitution')) {
            eventType = 'تبديل';
            eventIcon = '🔄';
          }
          
          matchReport.events.push({
            minute: minute,
            player: eventText,
            type: eventType,
            icon: eventIcon
          });
          
          console.log(`   📊 Event ${minute}': ${eventType} - ${eventText.substring(0, 30)}...`);
        }
      }
    }
    
    const competitionKeywords = ['أوروبا', 'يورو', 'تحت', 'بطولة', 'دوري', 'كأس'];
    for (const keyword of competitionKeywords) {
      if (bodyText.includes(keyword)) {
        const competitionRegex = new RegExp(`(${keyword}[^.\\n]{10,80})`, 'i');
        const competitionMatch = bodyText.match(competitionRegex);
        if (competitionMatch) {
          matchReport.league = competitionMatch[1].trim();
          console.log(`🏆 Found competition: ${matchReport.league}`);
          break;
        }
      }
    }
    
    console.log(`✅ Report extracted: Teams ${matchReport.homeTeam && matchReport.awayTeam ? 'YES' : 'NO'}, Score ${matchReport.found ? 'YES' : 'NO'}, Events: ${matchReport.events.length}, Logos: ${logos.length}`);
    
    return matchReport;
    
  } catch (error) {
    console.error(`❌ Error scraping match report:`, error.message);
    return {
      homeTeam: '',
      awayTeam: '',
      homeScore: 0,
      awayScore: 0,
      homeTeamLogo: '',
      awayTeamLogo: '',
      homeLineup: [],
      awayLineup: [],
      events: [],
      league: '',
      found: false
    };
  }
}

function generateRichMatchReport(matchReport, matchCard, dateCategory, publishedDate) {
  const homeTeamName = matchReport.homeTeam || matchCard.homeTeam;
  const awayTeamName = matchReport.awayTeam || matchCard.awayTeam;
  const finalScore = matchReport.found ? `${matchReport.homeScore} - ${matchReport.awayScore}` : 'غير متوفر';
  const competition = matchReport.league || 'غير محدد';
  
  const reportTitle = `تقرير المباراة: ${homeTeamName} ضد ${awayTeamName}${competition !== 'غير محدد' ? ' - ' + competition : ''}`;
  const headerColor = '#f39c12';
  
  const publishedDateFormatted = new Date(publishedDate).toLocaleDateString('ar-EG', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  const templateVersion = "SPORTLIVE_DECODED_V1_2025";
  
  const reportContent = `<!-- ${templateVersion} -->
<div class="match-report" style="max-width: 95%; margin: 2% auto; padding: 2%; background: linear-gradient(135deg, #f8f9fa 0%, #ffffff 100%); border-radius: 15px; box-shadow: 0 10px 30px rgba(0,0,0,0.1); font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
  
  <div class="header" style="text-align: center; margin-bottom: 3%; padding-bottom: 2%; border-bottom: 3px solid ${headerColor};">
    <h1 style="color: #2c3e50; margin: 0; font-size: clamp(20px, 5vw, 28px); font-weight: 700;">
      📊 تقرير المباراة الشامل
    </h1>
    <p style="color: #7f8c8d; margin: 1% 0 0 0; font-size: clamp(14px, 3vw, 16px);">${competition}</p>
  </div>
  
  <div class="score-section" style="background: linear-gradient(135deg, ${headerColor} 0%, #34495e 100%); color: white; padding: 3%; border-radius: 12px; margin-bottom: 3%; text-align: center;">
    <h2 style="margin: 0 0 2% 0; font-size: clamp(18px, 4vw, 24px);">النتيجة النهائية</h2>
    <div style="display: flex; justify-content: center; align-items: center; gap: 3%; flex-wrap: wrap;">
      <div style="text-align: center; flex: 1; min-width: 120px;">
        <div style="width: 60px; height: 60px; border-radius: 50%; margin: 0 auto 2%; display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,0.2);">
          ${matchReport.homeTeamLogo ? 
            `<img src="${matchReport.homeTeamLogo}" alt="${homeTeamName}" style="width: 50px; height: 50px; object-fit: contain; border-radius: 50%;">` :
            `<span style="font-size: 24px;">🏠</span>`
          }
        </div>
        <h3 style="margin: 0; font-size: clamp(14px, 3vw, 18px);">${homeTeamName}</h3>
      </div>
      <div style="background: rgba(255,255,255,0.2); padding: 2% 4%; border-radius: 12px; min-width: 120px;">
        <span style="font-size: clamp(24px, 8vw, 48px); font-weight: bold;">${finalScore}</span>
      </div>
      <div style="text-align: center; flex: 1; min-width: 120px;">
        <div style="width: 60px; height: 60px; border-radius: 50%; margin: 0 auto 2%; display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,0.2);">
          ${matchReport.awayTeamLogo ? 
            `<img src="${matchReport.awayTeamLogo}" alt="${awayTeamName}" style="width: 50px; height: 50px; object-fit: contain; border-radius: 50%;">` :
            `<span style="font-size: 24px;">🏃</span>`
          }
        </div>
        <h3 style="margin: 0; font-size: clamp(14px, 3vw, 18px);">${awayTeamName}</h3>
      </div>
    </div>
  </div>

  ${matchReport.events.length > 0 ? `
  <div style="background: white; padding: 3%; border-radius: 12px; margin-bottom: 3%; box-shadow: 0 5px 15px rgba(0,0,0,0.08);">
    <h3 style="color: #2c3e50; margin: 0 0 2% 0; font-size: clamp(18px, 4vw, 22px);">⚽ أحداث المباراة</h3>
    ${matchReport.events.slice(0, 8).map(event => `
      <div style="display: flex; align-items: center; gap: 3%; padding: 2%; margin-bottom: 2%; background: #f8f9fa; border-radius: 8px; border-left: 4px solid ${headerColor};">
        <div style="background: ${headerColor}; color: white; width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold;">${event.minute}'</div>
        <span style="font-size: 20px;">${event.icon}</span>
        <div style="flex: 1;">
          <p style="margin: 0; color: #2c3e50; font-weight: bold;">${event.player}</p>
          <p style="margin: 0; color: #7f8c8d; font-size: 14px;">${event.type}</p>
        </div>
      </div>
    `).join('')}
  </div>
  ` : ''}
  
  <div style="background: white; padding: 3%; border-radius: 12px; margin-bottom: 3%; box-shadow: 0 5px 15px rgba(0,0,0,0.08); width: 100%;">
    <h3 style="color: #2c3e50; margin: 0 0 2% 0; font-size: clamp(18px, 4vw, 22px);">📋 معلومات المباراة</h3>
    
    <div style="display: block; width: 100%;">
      <div style="padding: 3%; background: #f8f9fa; border-radius: 10px; border-left: 4px solid ${headerColor}; margin-bottom: 2%; width: 100%;">
        <p style="margin: 0; color: #34495e;"><strong>🏆 البطولة:</strong> ${competition}</p>
      </div>
      <div style="padding: 3%; background: #f8f9fa; border-radius: 10px; border-left: 4px solid ${headerColor}; margin-bottom: 2%; width: 100%;">
        <p style="margin: 0; color: #34495e;"><strong>📅 التاريخ:</strong> ${publishedDateFormatted}</p>
      </div>
      <div style="padding: 3%; background: #f8f9fa; border-radius: 10px; border-left: 4px solid ${headerColor}; margin-bottom: 2%; width: 100%;">
        <p style="margin: 0; color: #34495e;"><strong>🎯 النتيجة:</strong> ${finalScore}</p>
      </div>
      <div style="padding: 3%; background: #f8f9fa; border-radius: 10px; border-left: 4px solid ${headerColor}; margin-bottom: 2%; width: 100%;">
        <p style="margin: 0; color: #34495e;"><strong>📊 أحداث المباراة:</strong> ${matchReport.events.length} حدث</p>
      </div>
      <div style="padding: 3%; background: #f8f9fa; border-radius: 10px; border-left: 4px solid ${headerColor}; margin-bottom: 2%; width: 100%;">
        <p style="margin: 0; color: #34495e;"><strong>🔄 آخر تحديث:</strong> ${new Date().toLocaleDateString('ar-EG')}، ${new Date().toLocaleTimeString('ar-EG')}</p>
      </div>
    </div>
  </div>
  
  <div style="background: #fff3cd; padding: 3%; border-radius: 12px; margin-bottom: 3%; border-left: 4px solid #ffc107;">
    <h3 style="color: #856404; margin: 0 0 2% 0;">🎯 معلومات عامة</h3>
    <p style="margin: 0 0 2% 0; color: #856404;">
      <strong>انتهت المباراة</strong> بين فريق <strong>${homeTeamName}</strong> وفريق <strong>${awayTeamName}</strong>
      ${competition !== 'غير محدد' ? ` في إطار منافسات <strong>${competition}</strong>` : ''}
      ${matchReport.found ? ` بنتيجة <strong>${finalScore}</strong>` : ''}.
    </p>
    <p style="margin: 0; font-weight: 600; color: #856404;">
      للحصول على النتائج التفصيلية والملخص الكامل، يرجى متابعة القنوات الرياضية المختصة.
    </p>
  </div>
  
  <div style="background: #d4edda; padding: 3%; border-radius: 12px; border-left: 4px solid #28a745;">
    <h3 style="color: #155724; margin: 0 0 2% 0;">🔔 ملاحظة مهمة</h3>
    <p style="margin: 0; color: #155724;">
      هذا تقرير تلقائي يتم إنشاؤه لأرشفة معلومات المباراة. للحصول على النتائج الدقيقة والتفاصيل الكاملة، يرجى متابعة القنوات الرياضية الرسمية أو المواقع المتخصصة.
    </p>
  </div>
  
</div>`;

  return {
    title: reportTitle,
    content: reportContent
  };
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

function extractTeamsFromTitle(title) {
  let cleanTitle = title.replace(/تقرير المباراة:\s*/g, '').trim();
  
  const patterns = [
    /(.+?)\s+(?:vs|ضد)\s+(.+?)(?:\s+-\s+(.+))?$/i,
    /(.+?)\s+(?:vs|ضد)\s+(.+)/i
  ];
  
  for (const pattern of patterns) {
    const match = cleanTitle.match(pattern);
    if (match) {
      return {
        homeTeam: match[1].trim(),
        awayTeam: match[2].trim(),
        league: match[3] ? match[3].trim() : ''
      };
    }
  }
  
  return null;
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
  } else {
    return 'older';
  }
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

async function main() {
  try {
    console.log('🚀 Starting Fixed URL Decoder Scraper...');
    
    if (!BLOG_ID || !API_KEY || !ACCESS_TOKEN) {
      console.error('❌ Missing required environment variables');
      process.exit(1);
    }
    
    const matchCards = await parseKooraLiveTVHTML();
    
    if (matchCards.length === 0) {
      console.log('❌ No match cards found');
      return;
    }
    
    console.log(`\n🎯 Found ${matchCards.length} match cards, processing reports...`);
    
    let processedCount = 0;
    
    for (const matchCard of matchCards.slice(0, 5)) {
      try {
        console.log(`\n📋 Processing: ${matchCard.title}`);
        
        const matchReport = await scrapeMatchReportFromLink(matchCard.reportUrl);
        
        const report = generateRichMatchReport(matchReport, matchCard, 'yesterday', new Date());
        
        console.log(`📝 Generated report: ${report.title}`);
        console.log(`📊 Data: Score ${matchReport.found ? 'YES' : 'NO'}, Events: ${matchReport.events.length}, Logos: ${matchReport.homeTeamLogo ? 'YES' : 'NO'}`);
        
        const allPosts = await getAllBlogPosts(20);
        const matchPosts = allPosts.filter(post => isMatchPost(post.title));
        
        let existingPost = null;
        for (const post of matchPosts) {
          const teamInfo = extractTeamsFromTitle(post.title);
          if (teamInfo) {
            const homeMatch = teamInfo.homeTeam.toLowerCase().includes(matchCard.homeTeam.substring(0, 8).toLowerCase()) ||
                            matchCard.homeTeam.toLowerCase().includes(teamInfo.homeTeam.substring(0, 8).toLowerCase());
            
            const awayMatch = teamInfo.awayTeam.toLowerCase().includes(matchCard.awayTeam.substring(0, 8).toLowerCase()) ||
                            matchCard.awayTeam.toLowerCase().includes(teamInfo.awayTeam.substring(0, 8).toLowerCase());
            
            if (homeMatch && awayMatch) {
              existingPost = post;
              console.log(`🔍 Found matching post: "${post.title}" matches "${matchCard.title}"`);
              break;
            }
          }
        }
        
        if (existingPost) {
          console.log(`🔄 Updating existing post: ${existingPost.title}`);
          const success = await updatePost(existingPost.id, report.title, report.content);
          if (success) {
            processedCount++;
            console.log(`✅ Successfully updated with real KooraLiveTV data`);
          }
        } else {
          console.log(`📝 No matching existing post found for ${matchCard.title}`);
          console.log(`   Available posts:`);
          matchPosts.slice(0, 3).forEach(post => {
            console.log(`   - ${post.title}`);
          });
        }
        
        console.log('⏳ Waiting 20 seconds...');
        await new Promise(resolve => setTimeout(resolve, 20000));
        
      } catch (error) {
        console.error(`❌ Error processing ${matchCard.title}:`, error.message);
      }
    }
    
    console.log(`\n🎉 URL Decoder Processing Complete!`);
    console.log(`   ✅ Successfully processed: ${processedCount} matches`);
    console.log(`   📊 Total cards found: ${matchCards.length}`);
    console.log(`   🔗 Real data extracted from KooraLiveTV report pages`);
    console.log(`   📱 Posts updated with actual scores, logos, and events`);
    
  } catch (error) {
    console.error('💥 Error in main process:', error);
    process.exit(1);
  }
}

main();
