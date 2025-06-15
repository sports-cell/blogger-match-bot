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

async function searchMatchOnKooraLive(homeTeam, awayTeam) {
  try {
    console.log(`🔍 Searching for match: ${homeTeam} vs ${awayTeam}`);
    
    const searchUrl = `https://www.kooralivetv.com`;
    const response = await axios.get(searchUrl);
    const $ = cheerio.load(response.data);
    
    let matchData = {
      homeTeam,
      awayTeam,
      homeScore: 0,
      awayScore: 0,
      homeTeamLogo: null,
      awayTeamLogo: null,
      status: 'انتهت المباراة',
      events: [],
      found: false
    };
    
    const matches = [];
    $('.match-item, .AY_Match, [class*="match"]').each((index, element) => {
      const matchElement = $(element);
      const matchText = matchElement.text();
      
      if (matchText.includes(homeTeam) || matchText.includes(awayTeam)) {
        console.log(`Found potential match: ${matchText}`);
        
        const homeLogoImg = matchElement.find('img').first();
        const awayLogoImg = matchElement.find('img').last();
        
        if (homeLogoImg.length) {
          const logoSrc = homeLogoImg.attr('src') || homeLogoImg.attr('data-src');
          if (logoSrc && !logoSrc.includes('data:image')) {
            matchData.homeTeamLogo = logoSrc.startsWith('http') ? logoSrc : `https://www.kooralivetv.com${logoSrc}`;
          }
        }
        
        if (awayLogoImg.length && awayLogoImg[0] !== homeLogoImg[0]) {
          const logoSrc = awayLogoImg.attr('src') || awayLogoImg.attr('data-src');
          if (logoSrc && !logoSrc.includes('data:image')) {
            matchData.awayTeamLogo = logoSrc.startsWith('http') ? logoSrc : `https://www.kooralivetv.com${logoSrc}`;
          }
        }
        
        const scoreMatch = matchText.match(/(\d+)\s*-\s*(\d+)/);
        if (scoreMatch) {
          matchData.homeScore = parseInt(scoreMatch[1]);
          matchData.awayScore = parseInt(scoreMatch[2]);
          matchData.found = true;
          console.log(`✅ Found score: ${matchData.homeScore}-${matchData.awayScore}`);
        }
        
        const matchLink = matchElement.find('a').attr('href') || matchElement.attr('href');
        if (matchLink) {
          const fullLink = matchLink.startsWith('http') ? matchLink : `https://www.kooralivetv.com${matchLink}`;
          console.log(`🔗 Found match link: ${fullLink}`);
          matches.push(fullLink);
        }
      }
    });
    
    if (matches.length > 0 && !matchData.found) {
      console.log(`📄 Checking match page for detailed data...`);
      const detailedData = await getMatchDetails(matches[0], homeTeam, awayTeam);
      if (detailedData.found) {
        matchData = { ...matchData, ...detailedData };
      }
    }
    
    if (!matchData.homeTeamLogo || !matchData.awayTeamLogo) {
      const logoResults = await getTeamLogos(homeTeam, awayTeam);
      matchData.homeTeamLogo = matchData.homeTeamLogo || logoResults.homeLogo;
      matchData.awayTeamLogo = matchData.awayTeamLogo || logoResults.awayLogo;
    }
    
    return matchData;
    
  } catch (error) {
    console.error(`❌ Error searching match:`, error.message);
    return {
      homeTeam,
      awayTeam,
      homeScore: 0,
      awayScore: 0,
      homeTeamLogo: null,
      awayTeamLogo: null,
      status: 'انتهت المباراة',
      events: [],
      found: false
    };
  }
}

async function getMatchDetails(matchUrl, homeTeam, awayTeam) {
  try {
    console.log(`📊 Getting match details from: ${matchUrl}`);
    
    const response = await axios.get(matchUrl);
    const $ = cheerio.load(response.data);
    
    let matchData = {
      homeScore: 0,
      awayScore: 0,
      homeTeamLogo: null,
      awayTeamLogo: null,
      events: [],
      found: false
    };
    
    const scoreText = $('body').text();
    const scoreMatch = scoreText.match(/(\d+)\s*-\s*(\d+)/);
    if (scoreMatch) {
      matchData.homeScore = parseInt(scoreMatch[1]);
      matchData.awayScore = parseInt(scoreMatch[2]);
      matchData.found = true;
      console.log(`✅ Extracted score: ${matchData.homeScore}-${matchData.awayScore}`);
    }
    
    $('img').each((index, element) => {
      const img = $(element);
      const alt = img.attr('alt') || '';
      const src = img.attr('src') || img.attr('data-src');
      
      if (src && !src.includes('data:image') && alt) {
        if (alt.includes(homeTeam) || homeTeam.includes(alt)) {
          matchData.homeTeamLogo = src.startsWith('http') ? src : `https://www.kooralivetv.com${src}`;
          console.log(`🏠 Found home team logo: ${matchData.homeTeamLogo}`);
        } else if (alt.includes(awayTeam) || awayTeam.includes(alt)) {
          matchData.awayTeamLogo = src.startsWith('http') ? src : `https://www.kooralivetv.com${src}`;
          console.log(`🏃 Found away team logo: ${matchData.awayTeamLogo}`);
        }
      }
    });
    
    $('.event, [class*="goal"], [class*="card"], [class*="substitution"]').each((index, element) => {
      const eventElement = $(element);
      const eventText = eventElement.text().trim();
      
      if (eventText.length > 0) {
        matchData.events.push(eventText);
      }
    });
    
    return matchData;
    
  } catch (error) {
    console.error(`❌ Error getting match details:`, error.message);
    return { found: false };
  }
}

async function getTeamLogos(homeTeam, awayTeam) {
  try {
    const response = await axios.get('https://www.kooralivetv.com');
    const $ = cheerio.load(response.data);
    
    let homeLogo = null;
    let awayLogo = null;
    
    $('img').each((index, element) => {
      const img = $(element);
      const alt = img.attr('alt') || '';
      const src = img.attr('src') || img.attr('data-src');
      
      if (src && !src.includes('data:image') && alt) {
        if (alt.includes(homeTeam) || homeTeam.includes(alt)) {
          homeLogo = src.startsWith('http') ? src : `https://www.kooralivetv.com${src}`;
        } else if (alt.includes(awayTeam) || awayTeam.includes(alt)) {
          awayLogo = src.startsWith('http') ? src : `https://www.kooralivetv.com${src}`;
        }
      }
    });
    
    return { homeLogo, awayLogo };
    
  } catch (error) {
    console.error(`❌ Error getting team logos:`, error.message);
    return { homeLogo: null, awayLogo: null };
  }
}

function generateRichMatchReport(matchData, teamInfo, dateCategory, publishedDate) {
  const { homeTeam, awayTeam, league } = teamInfo;
  const { homeScore, awayScore, homeTeamLogo, awayTeamLogo, status, events, found } = matchData;
  
  let reportTitle = `تقرير المباراة: ${homeTeam} ضد ${awayTeam}`;
  if (league) {
    reportTitle += ` - ${league}`;
  }
  
  const headerColor = dateCategory === 'today' ? '#27ae60' : 
                     dateCategory === 'yesterday' ? '#f39c12' : '#95a5a6';
  
  let matchStatus = status || 'انتهت المباراة';
  let statusIcon = found ? '✅' : '📋';
  
  const publishedDateFormatted = new Date(publishedDate).toLocaleDateString('ar-EG', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  const finalScore = found ? `${homeScore} - ${awayScore}` : 'غير متوفر';
  const templateVersion = "SPORTLIVE_V3_2025";
  
  const reportContent = `<!-- ${templateVersion} -->
<div class="match-report" style="max-width: 90%; margin: 2% auto; padding: 3%; background: linear-gradient(135deg, #f8f9fa 0%, #ffffff 100%); border-radius: 15px; box-shadow: 0 10px 30px rgba(0,0,0,0.1); font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; border: 1px solid #e9ecef;">
  
  <div class="header" style="text-align: center; margin-bottom: 4%; padding-bottom: 3%; border-bottom: 3px solid ${headerColor};">
    <h1 style="color: #2c3e50; margin: 0; font-size: clamp(20px, 5vw, 28px); font-weight: 700;">
      📊 تقرير المباراة
    </h1>
    <p style="color: #7f8c8d; margin: 1% 0 0 0; font-size: clamp(14px, 3vw, 16px);">${league || 'مباراة كرة قدم'}</p>
  </div>
  
  <div class="score-section" style="background: linear-gradient(135deg, ${headerColor} 0%, #34495e 100%); color: white; padding: 4%; border-radius: 12px; margin-bottom: 4%; text-align: center; box-shadow: 0 8px 20px rgba(0,0,0,0.15);">
    <h2 style="margin: 0 0 3% 0; font-size: clamp(18px, 4vw, 24px); font-weight: 600;">النتيجة النهائية</h2>
    <div style="display: flex; justify-content: center; align-items: center; gap: 5%; flex-wrap: wrap;">
      <div style="text-align: center; flex: 1; min-width: 120px;">
        <h3 style="margin: 0; font-size: clamp(14px, 3vw, 18px); opacity: 0.9;">${homeTeam}</h3>
      </div>
      <div style="background: rgba(255,255,255,0.2); padding: 3% 5%; border-radius: 12px; backdrop-filter: blur(10px);">
        <span style="font-size: clamp(24px, 8vw, 48px); font-weight: bold; text-shadow: 2px 2px 4px rgba(0,0,0,0.3);">${finalScore}</span>
      </div>
      <div style="text-align: center; flex: 1; min-width: 120px;">
        <h3 style="margin: 0; font-size: clamp(14px, 3vw, 18px); opacity: 0.9;">${awayTeam}</h3>
      </div>
    </div>
  </div>
  
  <div class="teams-container" style="background: white; padding: 4%; border-radius: 12px; margin-bottom: 4%; box-shadow: 0 5px 15px rgba(0,0,0,0.08);">
    <div class="teams-display" style="display: flex; justify-content: space-between; align-items: center; gap: 5%; flex-wrap: wrap;">
      
      <div class="team home-team" style="text-align: center; flex: 1; min-width: 200px;">
        <div class="team-logo" style="width: 25%; height: auto; aspect-ratio: 1; border-radius: 50%; margin: 0 auto 3%; display: flex; align-items: center; justify-content: center; box-shadow: 0 8px 20px rgba(0,0,0,0.15); background: white; border: 4px solid ${headerColor}; overflow: hidden; max-width: 100px;">
          ${homeTeamLogo ? 
            `<img src="${homeTeamLogo}" alt="${homeTeam}" style="width: 90%; height: 90%; object-fit: contain;">` :
            `<span style="color: ${headerColor}; font-size: clamp(20px, 4vw, 32px); font-weight: bold;">⚽</span>`
          }
        </div>
        <h3 style="color: #2c3e50; margin: 0; font-size: clamp(16px, 3vw, 20px); font-weight: 600; word-wrap: break-word;">${homeTeam}</h3>
        <p style="color: #7f8c8d; margin: 2% 0 0 0; font-size: clamp(12px, 2.5vw, 14px);">الفريق المضيف</p>
        ${found ? `<div style="margin-top: 3%; padding: 2% 4%; background: ${homeScore > awayScore ? '#e8f5e8' : homeScore < awayScore ? '#ffebee' : '#fff3e0'}; border-radius: 8px; color: ${homeScore > awayScore ? '#2e7d32' : homeScore < awayScore ? '#c62828' : '#f57c00'}; font-weight: bold; font-size: clamp(18px, 4vw, 24px);">${homeScore}</div>` : ''}
      </div>
      
      <div class="vs-section" style="text-align: center; margin: 0 3%;">
        <div style="background: ${headerColor}; color: white; width: clamp(60px, 12vw, 80px); height: clamp(60px, 12vw, 80px); border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 2%; font-weight: bold; font-size: clamp(14px, 3vw, 20px); box-shadow: 0 8px 20px rgba(0,0,0,0.2);">
          VS
        </div>
        <p style="color: #95a5a6; margin: 0; font-size: clamp(10px, 2vw, 12px);">${publishedDateFormatted}</p>
      </div>
      
      <div class="team away-team" style="text-align: center; flex: 1; min-width: 200px;">
        <div class="team-logo" style="width: 25%; height: auto; aspect-ratio: 1; border-radius: 50%; margin: 0 auto 3%; display: flex; align-items: center; justify-content: center; box-shadow: 0 8px 20px rgba(0,0,0,0.15); background: white; border: 4px solid #e74c3c; overflow: hidden; max-width: 100px;">
          ${awayTeamLogo ? 
            `<img src="${awayTeamLogo}" alt="${awayTeam}" style="width: 90%; height: 90%; object-fit: contain;">` :
            `<span style="color: #e74c3c; font-size: clamp(20px, 4vw, 32px); font-weight: bold;">⚽</span>`
          }
        </div>
        <h3 style="color: #2c3e50; margin: 0; font-size: clamp(16px, 3vw, 20px); font-weight: 600; word-wrap: break-word;">${awayTeam}</h3>
        <p style="color: #7f8c8d; margin: 2% 0 0 0; font-size: clamp(12px, 2.5vw, 14px);">الفريق الضيف</p>
        ${found ? `<div style="margin-top: 3%; padding: 2% 4%; background: ${awayScore > homeScore ? '#e8f5e8' : awayScore < homeScore ? '#ffebee' : '#fff3e0'}; border-radius: 8px; color: ${awayScore > homeScore ? '#2e7d32' : awayScore < homeScore ? '#c62828' : '#f57c00'}; font-weight: bold; font-size: clamp(18px, 4vw, 24px);">${awayScore}</div>` : ''}
      </div>
    </div>
  </div>
  
  <div class="status-section" style="text-align: center; margin-bottom: 4%;">
    <div style="display: inline-block; padding: 3% 6%; background: ${headerColor}; color: white; border-radius: 50px; font-weight: 600; font-size: clamp(14px, 3vw, 18px); box-shadow: 0 8px 20px rgba(0,0,0,0.2);">
      ${statusIcon} ${matchStatus}
    </div>
  </div>

  ${events.length > 0 ? `
  <div class="events-section" style="background: white; padding: 4%; border-radius: 12px; margin-bottom: 4%; box-shadow: 0 5px 15px rgba(0,0,0,0.08);">
    <h3 style="color: #2c3e50; margin: 0 0 3% 0; font-size: clamp(18px, 4vw, 22px); display: flex; align-items: center; gap: 2%;">
      <span style="background: ${headerColor}; color: white; width: clamp(30px, 6vw, 40px); height: clamp(30px, 6vw, 40px); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: clamp(14px, 3vw, 18px);">⚽</span>
      أحداث المباراة
    </h3>
    <div class="events-list">
      ${events.slice(0, 10).map(event => `
        <div style="padding: 2% 3%; margin-bottom: 2%; background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%); border-radius: 8px; border-left: 4px solid ${headerColor};">
          <p style="margin: 0; color: #2c3e50; font-size: clamp(13px, 2.8vw, 15px);">${event}</p>
        </div>
      `).join('')}
    </div>
  </div>
  ` : ''}
  
  <div class="match-info" style="background: white; padding: 4%; border-radius: 12px; margin-bottom: 4%; box-shadow: 0 5px 15px rgba(0,0,0,0.08);">
    <h3 style="color: #2c3e50; margin: 0 0 3% 0; font-size: clamp(18px, 4vw, 22px); display: flex; align-items: center; gap: 2%;">
      <span style="background: ${headerColor}; color: white; width: clamp(30px, 6vw, 40px); height: clamp(30px, 6vw, 40px); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: clamp(14px, 3vw, 18px);">📋</span>
      معلومات المباراة
    </h3>
    
    <div class="info-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 3%;">
      
      <div class="info-card" style="padding: 4%; background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%); border-radius: 10px; border-left: 4px solid ${headerColor};">
        <div style="display: flex; align-items: center; gap: 3%; margin-bottom: 2%;">
          <span style="font-size: clamp(16px, 4vw, 20px);">🏆</span>
          <strong style="color: #2c3e50; font-size: clamp(14px, 3vw, 16px);">البطولة</strong>
        </div>
        <p style="margin: 0; color: #34495e; font-size: clamp(13px, 2.8vw, 15px);">${league || 'غير محدد'}</p>
      </div>
      
      <div class="info-card" style="padding: 4%; background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%); border-radius: 10px; border-left: 4px solid ${headerColor};">
        <div style="display: flex; align-items: center; gap: 3%; margin-bottom: 2%;">
          <span style="font-size: clamp(16px, 4vw, 20px);">📅</span>
          <strong style="color: #2c3e50; font-size: clamp(14px, 3vw, 16px);">التاريخ</strong>
        </div>
        <p style="margin: 0; color: #34495e; font-size: clamp(13px, 2.8vw, 15px);">${publishedDateFormatted}</p>
      </div>
      
      <div class="info-card" style="padding: 4%; background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%); border-radius: 10px; border-left: 4px solid ${headerColor};">
        <div style="display: flex; align-items: center; gap: 3%; margin-bottom: 2%;">
          <span style="font-size: clamp(16px, 4vw, 20px);">🎯</span>
          <strong style="color: #2c3e50; font-size: clamp(14px, 3vw, 16px);">النتيجة</strong>
        </div>
        <p style="margin: 0; color: #34495e; font-size: clamp(13px, 2.8vw, 15px);">${finalScore}</p>
      </div>
      
      <div class="info-card" style="padding: 4%; background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%); border-radius: 10px; border-left: 4px solid ${headerColor};">
        <div style="display: flex; align-items: center; gap: 3%; margin-bottom: 2%;">
          <span style="font-size: clamp(16px, 4vw, 20px);">📊</span>
          <strong style="color: #2c3e50; font-size: clamp(14px, 3vw, 16px);">الحالة</strong>
        </div>
        <p style="margin: 0; color: #34495e; font-size: clamp(13px, 2.8vw, 15px);">${found ? 'بيانات متوفرة' : 'بيانات محدودة'}</p>
      </div>
      
    </div>
  </div>
  
  <div class="summary-section" style="background: linear-gradient(135deg, #ffffff 0%, #f8f9fa 100%); padding: 4%; border-radius: 12px; margin-bottom: 4%; border: 1px solid #e9ecef;">
    <h3 style="color: ${headerColor}; margin: 0 0 3% 0; font-size: clamp(18px, 4vw, 22px); display: flex; align-items: center; gap: 2%;">
      <span style="background: ${headerColor}; color: white; width: clamp(30px, 6vw, 40px); height: clamp(30px, 6vw, 40px); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: clamp(14px, 3vw, 18px);">🎯</span>
      ملخص المباراة
    </h3>
    
    <div style="color: #2c3e50; line-height: 1.8; font-size: clamp(14px, 3vw, 16px);">
      <p style="margin: 0 0 3% 0;">
        <strong style="color: ${headerColor};">انتهت المباراة</strong> بين فريق <strong>${homeTeam}</strong> وفريق <strong>${awayTeam}</strong> 
        في إطار منافسات <strong>${league || 'البطولة'}</strong>
        ${found ? ` بنتيجة <strong style="color: ${headerColor};">${finalScore}</strong>` : ''}.
      </p>
      
      ${found ? `
        <div style="padding: 3%; background: ${homeScore > awayScore ? '#e8f5e8' : awayScore > homeScore ? '#ffebee' : '#fff3e0'}; border-radius: 8px; border-left: 4px solid ${homeScore > awayScore ? '#4caf50' : awayScore > homeScore ? '#f44336' : '#ff9800'}; margin: 3% 0;">
          <p style="margin: 0; color: ${homeScore > awayScore ? '#2e7d32' : awayScore > homeScore ? '#c62828' : '#f57c00'}; font-weight: bold;">
            ${homeScore > awayScore ? `🏆 فوز ${homeTeam} بنتيجة ${homeScore}-${awayScore}` : 
              awayScore > homeScore ? `🏆 فوز ${awayTeam} بنتيجة ${awayScore}-${homeScore}` : 
              `🤝 تعادل الفريقين بنتيجة ${homeScore}-${awayScore}`}
          </p>
        </div>
      ` : `
        <div style="padding: 3%; background: #fff3cd; border-radius: 8px; border-left: 4px solid #ffc107; margin: 3% 0;">
          <p style="margin: 0; color: #856404; font-weight: bold;">
            📊 للحصول على النتائج التفصيلية والملخص الكامل، يرجى متابعة القنوات الرياضية المختصة.
          </p>
        </div>
      `}
    </div>
  </div>
  
  <div class="links-section" style="background: white; padding: 4%; border-radius: 12px; box-shadow: 0 5px 15px rgba(0,0,0,0.08);">
    <h3 style="color: #2c3e50; margin: 0 0 3% 0; font-size: clamp(16px, 3.5vw, 20px); display: flex; align-items: center; gap: 2%;">
      <span style="background: ${headerColor}; color: white; width: clamp(28px, 5.5vw, 36px); height: clamp(28px, 5.5vw, 36px); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: clamp(12px, 2.5vw, 16px);">🔗</span>
      روابط سريعة
    </h3>
    
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 3%;">
      <a href="/" style="display: flex; align-items: center; gap: 2%; padding: 3% 4%; background: ${headerColor}; color: white; text-decoration: none; border-radius: 8px; font-weight: 600; transition: all 0.3s ease; box-shadow: 0 4px 12px rgba(0,0,0,0.2); font-size: clamp(12px, 2.8vw, 14px);">
        <span style="font-size: clamp(14px, 3.5vw, 18px);">🏠</span>
        الصفحة الرئيسية
      </a>
      <a href="/" style="display: flex; align-items: center; gap: 2%; padding: 3% 4%; background: #34495e; color: white; text-decoration: none; border-radius: 8px; font-weight: 600; transition: all 0.3s ease; box-shadow: 0 4px 12px rgba(0,0,0,0.2); font-size: clamp(12px, 2.8vw, 14px);">
        <span style="font-size: clamp(14px, 3.5vw, 18px);">⚽</span>
        مباريات أخرى
      </a>
      <a href="/" style="display: flex; align-items: center; gap: 2%; padding: 3% 4%; background: #e74c3c; color: white; text-decoration: none; border-radius: 8px; font-weight: 600; transition: all 0.3s ease; box-shadow: 0 4px 12px rgba(0,0,0,0.2); font-size: clamp(12px, 2.8vw, 14px);">
        <span style="font-size: clamp(14px, 3.5vw, 18px);">📺</span>
        البث المباشر
      </a>
    </div>
  </div>
  
</div>

<style>
.match-report a:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 18px rgba(0,0,0,0.3) !important;
}

@media (max-width: 768px) {
  .teams-display {
    flex-direction: column !important;
    gap: 6% !important;
  }
  
  .vs-section {
    order: 2;
    margin: 4% 0 !important;
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
  
  .score-section div {
    flex-direction: column !important;
    gap: 4% !important;
  }
}

@media (max-width: 480px) {
  .match-report {
    margin: 2% !important;
    padding: 4% !important;
  }
  
  .teams-container, .match-info, .summary-section, .links-section, .events-section, .score-section {
    padding: 4% !important;
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
    console.log('🚀 Starting to create rich match reports with real data...');
    
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
      
      let shouldUpdate = false;
      let reason = '';
      
      if (post.title.includes('تقرير المباراة') || post.content.includes('match-report')) {
        if (!post.content.includes('SPORTLIVE_V3_2025')) {
          console.log('🔄 Post is old report template - updating to rich data report...');
          shouldUpdate = true;
          reason = 'Updating old report to rich data template';
        } else {
          console.log('✅ Post already has rich data template, skipping...');
          skippedCount++;
          continue;
        }
      }
      
      if (!shouldUpdate) {
        if (dateCategory === 'older') {
          shouldUpdate = true;
          reason = 'Post is older than yesterday - converting to rich report';
        } 
        else if (dateCategory === 'yesterday') {
          shouldUpdate = true;
          reason = 'Yesterday\'s match - converting to rich report';
        } 
        else if (dateCategory === 'today') {
          const postAge = (new Date() - new Date(post.published)) / (1000 * 60 * 60);
          if (postAge > 4) {
            shouldUpdate = true;
            reason = `Today's match is ${postAge.toFixed(1)} hours old - converting to rich report`;
          } else {
            shouldUpdate = false;
            reason = `Today's match is only ${postAge.toFixed(1)} hours old - keeping as live`;
          }
        }
      }
      
      console.log(`🎯 Decision: ${shouldUpdate ? 'CONVERT TO RICH REPORT' : 'KEEP AS IS'} - ${reason}`);
      
      if (shouldUpdate) {
        const teamInfo = extractTeamsFromTitle(post.title);
        
        if (teamInfo) {
          console.log(`🔍 Searching for match data: ${teamInfo.homeTeam} vs ${teamInfo.awayTeam}`);
          
          const matchData = await searchMatchOnKooraLive(teamInfo.homeTeam, teamInfo.awayTeam);
          
          console.log(`📊 Match data found: Score ${matchData.homeScore}-${matchData.awayScore}, Logos: ${matchData.homeTeamLogo ? 'YES' : 'NO'}, Events: ${matchData.events.length}`);
          
          const report = generateRichMatchReport(matchData, teamInfo, dateCategory, post.published);
          
          const success = await updatePost(post.id, report.title, report.content);
          
          if (success) {
            updatedCount++;
            console.log('✅ Post converted to rich data report successfully');
          } else {
            errorCount++;
          }
        } else {
          console.log('❌ Could not extract team names from title');
          skippedCount++;
        }
        
        console.log('⏳ Waiting 30 seconds...');
        await new Promise(resolve => setTimeout(resolve, 30000));
      } else {
        skippedCount++;
      }
    }
    
    console.log(`\n🎉 Rich Report Generation Complete!`);
    console.log(`   ✅ Converted to rich reports: ${updatedCount} posts`);
    console.log(`   ⏭️ Skipped (already updated or too recent): ${skippedCount} posts`);
    console.log(`   ❌ Errors: ${errorCount} posts`);
    console.log(`   📊 Total processed: ${updatedCount + skippedCount + errorCount}`);
    
  } catch (error) {
    console.error('💥 Error in updateMatchPosts:', error);
    process.exit(1);
  }
}

updateMatchPosts();)
