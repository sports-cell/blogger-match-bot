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

async function findMatchUrlOnKooraLive(homeTeam, awayTeam) {
  try {
    console.log(`🔍 Searching for match URL: ${homeTeam} vs ${awayTeam}`);
    
    const searchQuery = `${homeTeam} ${awayTeam}`.replace(/\s+/g, '-').toLowerCase();
    const possibleUrls = [
      `https://www.kooralivetv.com/matches/${encodeURIComponent(homeTeam)}-و-${encodeURIComponent(awayTeam)}-في-أوروبا-يو/`,
      `https://www.kooralivetv.com/matches/${searchQuery}/`,
      `https://www.kooralivetv.com/matches/${encodeURIComponent(homeTeam)}-vs-${encodeURIComponent(awayTeam)}/`
    ];
    
    for (const url of possibleUrls) {
      try {
        const response = await axios.get(url, { timeout: 10000 });
        if (response.status === 200 && response.data.includes(homeTeam) && response.data.includes(awayTeam)) {
          console.log(`✅ Found match URL: ${url}`);
          return url;
        }
      } catch (error) {
        continue;
      }
    }
    
    console.log(`❌ No match URL found for ${homeTeam} vs ${awayTeam}`);
    return null;
    
  } catch (error) {
    console.error(`❌ Error finding match URL:`, error.message);
    return null;
  }
}

async function scrapeRichMatchData(matchUrl) {
  try {
    console.log(`📊 Scraping rich match data from: ${matchUrl}`);
    
    const response = await axios.get(matchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 15000
    });
    
    const $ = cheerio.load(response.data);
    
    const matchData = {
      homeTeam: '',
      awayTeam: '',
      homeScore: 0,
      awayScore: 0,
      homeTeamLogo: '',
      awayTeamLogo: '',
      homeLineup: [],
      awayLineup: [],
      homeSubstitutes: [],
      awaySubstitutes: [],
      events: [],
      matchInfo: {},
      found: false
    };
    
    const finalScoreText = $('body').text();
    const scoreMatch = finalScoreText.match(/نتيجة المباراة.*?(\w+)\s+(\d+)\s*-\s*(\d+)\s+(\w+)/);
    if (scoreMatch) {
      matchData.homeTeam = scoreMatch[1];
      matchData.homeScore = parseInt(scoreMatch[2]);
      matchData.awayScore = parseInt(scoreMatch[3]);
      matchData.awayTeam = scoreMatch[4];
      matchData.found = true;
      console.log(`✅ Found score: ${matchData.homeTeam} ${matchData.homeScore}-${matchData.awayScore} ${matchData.awayTeam}`);
    }
    
    $('img').each((index, element) => {
      const img = $(element);
      const alt = img.attr('alt') || '';
      const src = img.attr('src') || img.attr('data-src');
      
      if (src && alt && src.includes('kooralivetv.com') && !src.includes('event')) {
        if (alt.includes('تحت') || alt.includes('U19') || alt.includes('U20') || alt.includes('U21')) {
          if (!matchData.homeTeamLogo) {
            matchData.homeTeamLogo = src;
            console.log(`🏠 Found home team logo: ${src}`);
          } else if (!matchData.awayTeamLogo && src !== matchData.homeTeamLogo) {
            matchData.awayTeamLogo = src;
            console.log(`🏃 Found away team logo: ${src}`);
          }
        }
      }
    });
    
    const homeLineupSection = $('body').html().split('4-4-2')[1];
    const awayLineupSection = $('body').html().split('4-1-4-1')[1];
    
    if (homeLineupSection) {
      const homePlayerRegex = /(\d+)\s*([^\d\n]+?)\s*(?:حارس مرمى|الدفاع|الوسط|الهجوم)/g;
      let homeMatch;
      while ((homeMatch = homePlayerRegex.exec(homeLineupSection)) !== null && matchData.homeLineup.length < 11) {
        matchData.homeLineup.push({
          number: homeMatch[1],
          name: homeMatch[2].trim(),
          position: homeMatch[3] || 'لاعب'
        });
      }
    }
    
    if (awayLineupSection) {
      const awayPlayerRegex = /(\d+)\s*([^\d\n]+?)\s*(?:حارس مرمى|الدفاع|الوسط|الهجوم)/g;
      let awayMatch;
      while ((awayMatch = awayPlayerRegex.exec(awayLineupSection)) !== null && matchData.awayLineup.length < 11) {
        matchData.awayLineup.push({
          number: awayMatch[1],
          name: awayMatch[2].trim(),
          position: awayMatch[3] || 'لاعب'
        });
      }
    }
    
    const eventRegex = /(\d+)\s*([^!]+?)!\[([^!]+)!\]\([^)]+\)/g;
    let eventMatch;
    while ((eventMatch = eventRegex.exec(response.data)) !== null) {
      const minute = eventMatch[1];
      const player = eventMatch[2].trim();
      const eventType = eventMatch[3];
      
      let eventIcon = '⚽';
      let eventDescription = 'حدث';
      
      if (eventType.includes('هدف')) {
        eventIcon = '⚽';
        eventDescription = 'هدف';
      } else if (eventType.includes('بطاقة صفراء')) {
        eventIcon = '🟨';
        eventDescription = 'بطاقة صفراء';
      } else if (eventType.includes('بطاقة حمراء')) {
        eventIcon = '🟥';
        eventDescription = 'بطاقة حمراء';
      } else if (eventType.includes('قائمة البدلاء')) {
        eventIcon = '🔄';
        eventDescription = 'تبديل';
      }
      
      matchData.events.push({
        minute,
        player,
        type: eventDescription,
        icon: eventIcon
      });
    }
    
    const tableMatch = response.data.match(/بطاقة المباراة[\s\S]*?<\/table>/);
    if (tableMatch) {
      const tableHtml = tableMatch[0];
      const $table = cheerio.load(tableHtml);
      
      $table('tr').each((index, row) => {
        const cells = $table(row).find('td');
        if (cells.length >= 2) {
          const key = $table(cells[0]).text().trim();
          const value = $table(cells[1]).text().trim();
          matchData.matchInfo[key] = value;
        }
      });
    }
    
    console.log(`📊 Match data extracted: ${matchData.events.length} events, ${matchData.homeLineup.length} home players, ${matchData.awayLineup.length} away players`);
    
    return matchData;
    
  } catch (error) {
    console.error(`❌ Error scraping match data:`, error.message);
    return { found: false };
  }
}

function generateRichMatchReport(matchData, teamInfo, dateCategory, publishedDate) {
  const { homeTeam, awayTeam, league } = teamInfo;
  const { 
    homeScore, awayScore, homeTeamLogo, awayTeamLogo, 
    homeLineup, awayLineup, events, matchInfo, found 
  } = matchData;
  
  let reportTitle = `تقرير المباراة: ${homeTeam} ضد ${awayTeam}`;
  if (league) {
    reportTitle += ` - ${league}`;
  }
  
  const headerColor = dateCategory === 'today' ? '#27ae60' : 
                     dateCategory === 'yesterday' ? '#f39c12' : '#95a5a6';
  
  const publishedDateFormatted = new Date(publishedDate).toLocaleDateString('ar-EG', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  const finalScore = found ? `${homeScore} - ${awayScore}` : 'غير متوفر';
  const templateVersion = "SPORTLIVE_RICH_V4_2025";
  
  const reportContent = `<!-- ${templateVersion} -->
<div class="match-report" style="max-width: 95%; margin: 2% auto; padding: 2%; background: linear-gradient(135deg, #f8f9fa 0%, #ffffff 100%); border-radius: 15px; box-shadow: 0 10px 30px rgba(0,0,0,0.1); font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; border: 1px solid #e9ecef;">
  
  <div class="header" style="text-align: center; margin-bottom: 3%; padding-bottom: 2%; border-bottom: 3px solid ${headerColor};">
    <h1 style="color: #2c3e50; margin: 0; font-size: clamp(20px, 5vw, 28px); font-weight: 700;">
      📊 تقرير المباراة الشامل
    </h1>
    <p style="color: #7f8c8d; margin: 1% 0 0 0; font-size: clamp(14px, 3vw, 16px);">${league || 'مباراة كرة قدم'}</p>
  </div>
  
  <div class="score-section" style="background: linear-gradient(135deg, ${headerColor} 0%, #34495e 100%); color: white; padding: 3%; border-radius: 12px; margin-bottom: 3%; text-align: center; box-shadow: 0 8px 20px rgba(0,0,0,0.15);">
    <h2 style="margin: 0 0 2% 0; font-size: clamp(18px, 4vw, 24px); font-weight: 600;">النتيجة النهائية</h2>
    <div style="display: flex; justify-content: center; align-items: center; gap: 3%; flex-wrap: wrap;">
      <div style="text-align: center; flex: 1; min-width: 120px;">
        <div style="width: 60px; height: 60px; border-radius: 50%; margin: 0 auto 2%; display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,0.2); backdrop-filter: blur(10px);">
          ${homeTeamLogo ? 
            `<img src="${homeTeamLogo}" alt="${homeTeam}" style="width: 50px; height: 50px; object-fit: contain; border-radius: 50%;">` :
            `<span style="font-size: 24px;">🏠</span>`
          }
        </div>
        <h3 style="margin: 0; font-size: clamp(14px, 3vw, 18px); opacity: 0.9;">${homeTeam}</h3>
      </div>
      <div style="background: rgba(255,255,255,0.2); padding: 2% 4%; border-radius: 12px; backdrop-filter: blur(10px); min-width: 120px;">
        <span style="font-size: clamp(24px, 8vw, 48px); font-weight: bold; text-shadow: 2px 2px 4px rgba(0,0,0,0.3);">${finalScore}</span>
      </div>
      <div style="text-align: center; flex: 1; min-width: 120px;">
        <div style="width: 60px; height: 60px; border-radius: 50%; margin: 0 auto 2%; display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,0.2); backdrop-filter: blur(10px);">
          ${awayTeamLogo ? 
            `<img src="${awayTeamLogo}" alt="${awayTeam}" style="width: 50px; height: 50px; object-fit: contain; border-radius: 50%;">` :
            `<span style="font-size: 24px;">🏃</span>`
          }
        </div>
        <h3 style="margin: 0; font-size: clamp(14px, 3vw, 18px); opacity: 0.9;">${awayTeam}</h3>
      </div>
    </div>
  </div>

  ${events.length > 0 ? `
  <div class="events-section" style="background: white; padding: 3%; border-radius: 12px; margin-bottom: 3%; box-shadow: 0 5px 15px rgba(0,0,0,0.08);">
    <h3 style="color: #2c3e50; margin: 0 0 2% 0; font-size: clamp(18px, 4vw, 22px); display: flex; align-items: center; gap: 2%;">
      <span style="background: ${headerColor}; color: white; width: clamp(30px, 6vw, 40px); height: clamp(30px, 6vw, 40px); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: clamp(14px, 3vw, 18px);">⚽</span>
      أحداث المباراة المهمة
    </h3>
    <div class="events-timeline">
      ${events.slice(0, 15).map(event => `
        <div style="display: flex; align-items: center; gap: 3%; padding: 2%; margin-bottom: 2%; background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%); border-radius: 8px; border-left: 4px solid ${headerColor};">
          <div style="background: ${headerColor}; color: white; width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 14px;">${event.minute}'</div>
          <span style="font-size: 20px;">${event.icon}</span>
          <div style="flex: 1;">
            <p style="margin: 0; color: #2c3e50; font-size: clamp(13px, 2.8vw, 15px); font-weight: bold;">${event.player}</p>
            <p style="margin: 0; color: #7f8c8d; font-size: clamp(11px, 2.5vw, 13px);">${event.type}</p>
          </div>
        </div>
      `).join('')}
    </div>
  </div>
  ` : ''}

  ${homeLineup.length > 0 || awayLineup.length > 0 ? `
  <div class="lineups-section" style="background: white; padding: 3%; border-radius: 12px; margin-bottom: 3%; box-shadow: 0 5px 15px rgba(0,0,0,0.08);">
    <h3 style="color: #2c3e50; margin: 0 0 2% 0; font-size: clamp(18px, 4vw, 22px); display: flex; align-items: center; gap: 2%;">
      <span style="background: ${headerColor}; color: white; width: clamp(30px, 6vw, 40px); height: clamp(30px, 6vw, 40px); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: clamp(14px, 3vw, 18px);">👥</span>
      تشكيلة الفريقين
    </h3>
    
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 3%; margin-top: 2%;">
      ${homeLineup.length > 0 ? `
      <div style="padding: 3%; background: linear-gradient(135deg, #e8f5e8 0%, #c8e6c9 100%); border-radius: 10px; border-left: 4px solid #4caf50;">
        <h4 style="margin: 0 0 2% 0; color: #2e7d32; font-size: clamp(16px, 3.5vw, 20px); text-align: center;">${homeTeam}</h4>
        ${homeLineup.slice(0, 11).map(player => `
          <div style="display: flex; align-items: center; gap: 2%; padding: 1% 0; border-bottom: 1px solid rgba(46, 125, 50, 0.1);">
            <div style="background: #4caf50; color: white; width: 25px; height: 25px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: bold;">${player.number}</div>
            <div style="flex: 1;">
              <p style="margin: 0; color: #2e7d32; font-size: clamp(12px, 2.5vw, 14px); font-weight: bold;">${player.name}</p>
              <p style="margin: 0; color: #66bb6a; font-size: clamp(10px, 2vw, 12px);">${player.position}</p>
            </div>
          </div>
        `).join('')}
      </div>
      ` : ''}
      
      ${awayLineup.length > 0 ? `
      <div style="padding: 3%; background: linear-gradient(135deg, #ffebee 0%, #ffcdd2 100%); border-radius: 10px; border-left: 4px solid #f44336;">
        <h4 style="margin: 0 0 2% 0; color: #c62828; font-size: clamp(16px, 3.5vw, 20px); text-align: center;">${awayTeam}</h4>
        ${awayLineup.slice(0, 11).map(player => `
          <div style="display: flex; align-items: center; gap: 2%; padding: 1% 0; border-bottom: 1px solid rgba(198, 40, 40, 0.1);">
            <div style="background: #f44336; color: white; width: 25px; height: 25px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: bold;">${player.number}</div>
            <div style="flex: 1;">
              <p style="margin: 0; color: #c62828; font-size: clamp(12px, 2.5vw, 14px); font-weight: bold;">${player.name}</p>
              <p style="margin: 0; color: #ef5350; font-size: clamp(10px, 2vw, 12px);">${player.position}</p>
            </div>
          </div>
        `).join('')}
      </div>
      ` : ''}
    </div>
  </div>
  ` : ''}
  
  <div class="match-info" style="background: white; padding: 3%; border-radius: 12px; margin-bottom: 3%; box-shadow: 0 5px 15px rgba(0,0,0,0.08);">
    <h3 style="color: #2c3e50; margin: 0 0 2% 0; font-size: clamp(18px, 4vw, 22px); display: flex; align-items: center; gap: 2%;">
      <span style="background: ${headerColor}; color: white; width: clamp(30px, 6vw, 40px); height: clamp(30px, 6vw, 40px); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: clamp(14px, 3vw, 18px);">📋</span>
      معلومات المباراة
    </h3>
    
    <div class="info-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 2%;">
      
      <div class="info-card" style="padding: 3%; background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%); border-radius: 10px; border-left: 4px solid ${headerColor};">
        <div style="display: flex; align-items: center; gap: 2%; margin-bottom: 1%;">
          <span style="font-size: clamp(16px, 4vw, 20px);">🏆</span>
          <strong style="color: #2c3e50; font-size: clamp(14px, 3vw, 16px);">البطولة</strong>
        </div>
        <p style="margin: 0; color: #34495e; font-size: clamp(13px, 2.8vw, 15px);">${league || 'غير محدد'}</p>
      </div>
      
      <div class="info-card" style="padding: 3%; background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%); border-radius: 10px; border-left: 4px solid ${headerColor};">
        <div style="display: flex; align-items: center; gap: 2%; margin-bottom: 1%;">
          <span style="font-size: clamp(16px, 4vw, 20px);">📅</span>
          <strong style="color: #2c3e50; font-size: clamp(14px, 3vw, 16px);">التاريخ</strong>
        </div>
        <p style="margin: 0; color: #34495e; font-size: clamp(13px, 2.8vw, 15px);">${publishedDateFormatted}</p>
      </div>
      
      <div class="info-card" style="padding: 3%; background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%); border-radius: 10px; border-left: 4px solid ${headerColor};">
        <div style="display: flex; align-items: center; gap: 2%; margin-bottom: 1%;">
          <span style="font-size: clamp(16px, 4vw, 20px);">🎯</span>
          <strong style="color: #2c3e50; font-size: clamp(14px, 3vw, 16px);">النتيجة</strong>
        </div>
        <p style="margin: 0; color: #34495e; font-size: clamp(13px, 2.8vw, 15px);">${finalScore}</p>
      </div>
      
      <div class="info-card" style="padding: 3%; background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%); border-radius: 10px; border-left: 4px solid ${headerColor};">
        <div style="display: flex; align-items: center; gap: 2%; margin-bottom: 1%;">
          <span style="font-size: clamp(16px, 4vw, 20px);">📊</span>
          <strong style="color: #2c3e50; font-size: clamp(14px, 3vw, 16px);">أحداث المباراة</strong>
        </div>
        <p style="margin: 0; color: #34495e; font-size: clamp(13px, 2.8vw, 15px);">${events.length} حدث</p>
      </div>
      
    </div>
  </div>
  
  <div class="summary-section" style="background: linear-gradient(135deg, #ffffff 0%, #f8f9fa 100%); padding: 3%; border-radius: 12px; margin-bottom: 3%; border: 1px solid #e9ecef;">
    <h3 style="color: ${headerColor}; margin: 0 0 2% 0; font-size: clamp(18px, 4vw, 22px); display: flex; align-items: center; gap: 2%;">
      <span style="background: ${headerColor}; color: white; width: clamp(30px, 6vw, 40px); height: clamp(30px, 6vw, 40px); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: clamp(14px, 3vw, 18px);">🎯</span>
      ملخص المباراة
    </h3>
    
    <div style="color: #2c3e50; line-height: 1.8; font-size: clamp(14px, 3vw, 16px);">
      <p style="margin: 0 0 2% 0;">
        <strong style="color: ${headerColor};">انتهت المباراة</strong> بين فريق <strong>${homeTeam}</strong> وفريق <strong>${awayTeam}</strong> 
        في إطار منافسات <strong>${league || 'البطولة'}</strong>
        ${found ? ` بنتيجة <strong style="color: ${headerColor};">${finalScore}</strong>` : ''}.
      </p>
      
      ${found && events.length > 0 ? `
        <div style="padding: 2%; background: ${homeScore > awayScore ? '#e8f5e8' : awayScore > homeScore ? '#ffebee' : '#fff3e0'}; border-radius: 8px; border-left: 4px solid ${homeScore > awayScore ? '#4caf50' : awayScore > homeScore ? '#f44336' : '#ff9800'}; margin: 2% 0;">
          <p style="margin: 0; color: ${homeScore > awayScore ? '#2e7d32' : awayScore > homeScore ? '#c62828' : '#f57c00'}; font-weight: bold;">
            ${homeScore > awayScore ? `🏆 فوز ${homeTeam} بنتيجة ${homeScore}-${awayScore}` : 
              awayScore > homeScore ? `🏆 فوز ${awayTeam} بنتيجة ${awayScore}-${homeScore}` : 
              `🤝 تعادل الفريقين بنتيجة ${homeScore}-${awayScore}`}
          </p>
          <p style="margin: 1% 0 0 0; color: #666; font-size: clamp(12px, 2.5vw, 14px);">
            شهدت المباراة ${events.length} حدث مهم مع عروض مثيرة من الفريقين.
          </p>
        </div>
      ` : `
        <div style="padding: 2%; background: #fff3cd; border-radius: 8px; border-left: 4px solid #ffc107; margin: 2% 0;">
          <p style="margin: 0; color: #856404; font-weight: bold;">
          📊 للحصول على المزيد من التفاصيل والإحصائيات، يرجى متابعة القنوات الرياضية المختصة.
          </p>
        </div>
      `}
    </div>
  </div>
  
  <div class="links-section" style="background: white; padding: 3%; border-radius: 12px; box-shadow: 0 5px 15px rgba(0,0,0,0.08);">
    <h3 style="color: #2c3e50; margin: 0 0 2% 0; font-size: clamp(16px, 3.5vw, 20px); display: flex; align-items: center; gap: 2%;">
      <span style="background: ${headerColor}; color: white; width: clamp(28px, 5.5vw, 36px); height: clamp(28px, 5.5vw, 36px); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: clamp(12px, 2.5vw, 16px);">🔗</span>
      روابط سريعة
    </h3>
    
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 2%;">
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
      <a href="/" style="display: flex; align-items: center; gap: 2%; padding: 3% 4%; background: #8e44ad; color: white; text-decoration: none; border-radius: 8px; font-weight: 600; transition: all 0.3s ease; box-shadow: 0 4px 12px rgba(0,0,0,0.2); font-size: clamp(12px, 2.8vw, 14px);">
        <span style="font-size: clamp(14px, 3.5vw, 18px);">📊</span>
        الإحصائيات
      </a>
    </div>
  </div>
  
  <div class="footer-section" style="text-align: center; margin-top: 3%; padding: 2%; background: linear-gradient(135deg, #2c3e50 0%, #34495e 100%); color: white; border-radius: 12px;">
    <p style="margin: 0; font-size: clamp(12px, 2.5vw, 14px); opacity: 0.9;">
      📱 تابعونا للحصول على آخر أخبار كرة القدم ونتائج المباريات لحظة بلحظة
    </p>
    <div style="margin-top: 1%; display: flex; justify-content: center; gap: 3%; flex-wrap: wrap;">
      <span style="background: rgba(255,255,255,0.2); padding: 1% 2%; border-radius: 20px; font-size: clamp(10px, 2vw, 12px);">⚽ كرة القدم</span>
      <span style="background: rgba(255,255,255,0.2); padding: 1% 2%; border-radius: 20px; font-size: clamp(10px, 2vw, 12px);">📺 بث مباشر</span>
      <span style="background: rgba(255,255,255,0.2); padding: 1% 2%; border-radius: 20px; font-size: clamp(10px, 2vw, 12px);">📊 إحصائيات</span>
    </div>
  </div>
  
</div>

<style>
.match-report a:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 18px rgba(0,0,0,0.3) !important;
}

.match-report .info-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 20px rgba(0,0,0,0.15);
  transition: all 0.3s ease;
}

.match-report .events-timeline > div:hover {
  background: linear-gradient(135deg, #e3f2fd 0%, #bbdefb 100%) !important;
  transform: translateX(5px);
  transition: all 0.3s ease;
}

@media (max-width: 768px) {
  .info-grid {
    grid-template-columns: 1fr !important;
  }
  
  .lineups-section > div {
    grid-template-columns: 1fr !important;
  }
  
  .links-section div {
    grid-template-columns: 1fr !important;
  }
  
  .score-section > div {
    flex-direction: column !important;
    gap: 4% !important;
  }
}

@media (max-width: 480px) {
  .match-report {
    margin: 1% !important;
    padding: 3% !important;
  }
  
  .links-section div {
    grid-template-columns: repeat(2, 1fr) !important;
  }
}

@media (max-width: 320px) {
  .links-section div {
    grid-template-columns: 1fr !important;
  }
}
</style>

<!-- Template Version: SPORTLIVE_RICH_V4_2025 -->
<!-- Generated with KooraLiveTV Rich Data Scraper -->
<!-- Responsive Design with Real Match Data -->`;

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
    console.log('🚀 Starting to create RICH match reports with real KooraLiveTV data...');
    
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
        if (!post.content.includes('SPORTLIVE_RICH_V4_2025')) {
          console.log('🔄 Post is old report template - updating to RICH data report...');
          shouldUpdate = true;
          reason = 'Updating old report to RICH data template with lineups and events';
        } else {
          console.log('✅ Post already has RICH data template, skipping...');
          skippedCount++;
          continue;
        }
      }
      
      if (!shouldUpdate) {
        if (dateCategory === 'older') {
          shouldUpdate = true;
          reason = 'Post is older than yesterday - converting to RICH report';
        } 
        else if (dateCategory === 'yesterday') {
          shouldUpdate = true;
          reason = 'Yesterday\'s match - converting to RICH report';
        } 
        else if (dateCategory === 'today') {
          const postAge = (new Date() - new Date(post.published)) / (1000 * 60 * 60);
          if (postAge > 4) {
            shouldUpdate = true;
            reason = `Today's match is ${postAge.toFixed(1)} hours old - converting to RICH report`;
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
          console.log(`🔍 Searching for RICH match data: ${teamInfo.homeTeam} vs ${teamInfo.awayTeam}`);
          
          const matchUrl = await findMatchUrlOnKooraLive(teamInfo.homeTeam, teamInfo.awayTeam);
          
          let matchData = { found: false };
          if (matchUrl) {
            matchData = await scrapeRichMatchData(matchUrl);
          }
          
          console.log(`📊 RICH data found: Score ${matchData.homeScore || 0}-${matchData.awayScore || 0}, Events: ${matchData.events?.length || 0}, Lineups: ${matchData.homeLineup?.length || 0}+${matchData.awayLineup?.length || 0}`);
          
          const report = generateRichMatchReport(matchData, teamInfo, dateCategory, post.published);
          
          const success = await updatePost(post.id, report.title, report.content);
          
          if (success) {
            updatedCount++;
            console.log('✅ Post converted to RICH data report successfully');
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
    
    console.log(`\n🎉 RICH Report Generation Complete!`);
    console.log(`   ✅ Converted to RICH reports: ${updatedCount} posts`);
    console.log(`   ⏭️ Skipped (already updated or too recent): ${skippedCount} posts`);
    console.log(`   ❌ Errors: ${errorCount} posts`);
    console.log(`   📊 Total processed: ${updatedCount + skippedCount + errorCount}`);
    
  } catch (error) {
    console.error('💥 Error in updateMatchPosts:', error);
    process.exit(1);
  }
}

updateMatchPosts();
