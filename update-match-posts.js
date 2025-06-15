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

async function findYesterdayMatchCards() {
  try {
    console.log('🔍 Searching for yesterday match cards on KooraLiveTV...');
    
    const possibleUrls = [
      'https://www.kooralivetv.com/matches-yesterday/',
      'https://www.kooralivetv.com/yesterday/',
      'https://www.kooralivetv.com/',
      'https://www.kooralivetv.com/category/yesterday-matches/',
      'https://www.kooralivetv.com/results/'
    ];
    
    for (const url of possibleUrls) {
      try {
        console.log(`📡 Checking: ${url}`);
        
        const response = await axios.get(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          },
          timeout: 15000
        });
        
        const $ = cheerio.load(response.data);
        const matchCards = [];
        
        const cardSelectors = [
          'a[href*="match"]',
          'a[href*="vs"]', 
          'a[href*="ضد"]',
          '.match-link a',
          '.game-card a',
          '.fixture a',
          '[data-match] a',
          'a[title*="vs"]',
          'a[title*="ضد"]'
        ];
        
        for (const selector of cardSelectors) {
          $(selector).each((index, element) => {
            const link = $(element);
            const href = link.attr('href');
            const title = link.attr('title') || link.text().trim();
            
            if (href && title && (title.includes('vs') || title.includes('ضد'))) {
              let fullHref = href;
              if (!fullHref.startsWith('http')) {
                fullHref = 'https://www.kooralivetv.com' + fullHref;
              }
              
              const vsMatch = title.match(/(.+?)\s+(?:vs|ضد)\s+(.+)/i);
              if (vsMatch) {
                matchCards.push({
                  homeTeam: vsMatch[1].trim(),
                  awayTeam: vsMatch[2].trim(),
                  title: title.trim(),
                  reportUrl: fullHref
                });
                
                console.log(`✅ Found match card: ${title} -> ${fullHref}`);
              }
            }
          });
          
          if (matchCards.length > 0) break;
        }
        
        if (matchCards.length === 0) {
          console.log('🔄 Trying alternative method...');
          
          $('a').each((index, element) => {
            const link = $(element);
            const href = link.attr('href');
            const text = link.text().trim();
            
            if (href && text && 
                (href.includes('مباراة') || href.includes('match') || href.includes('vs') || 
                 text.includes('vs') || text.includes('ضد') || text.includes('تحت'))) {
              
              let fullHref = href;
              if (!fullHref.startsWith('http')) {
                fullHref = 'https://www.kooralivetv.com' + fullHref;
              }
              
              let homeTeam = '', awayTeam = '';
              
              const vsMatch = text.match(/(.+?)\s+(?:vs|ضد)\s+(.+)/i);
              if (vsMatch) {
                homeTeam = vsMatch[1].trim();
                awayTeam = vsMatch[2].trim();
              } else {
                const hrefMatch = href.match(/([^\/]+)-(?:vs|ضد)-([^\/]+)/i);
                if (hrefMatch) {
                  homeTeam = hrefMatch[1].replace(/-/g, ' ').trim();
                  awayTeam = hrefMatch[2].replace(/-/g, ' ').trim();
                }
              }
              
              if (homeTeam && awayTeam) {
                matchCards.push({
                  homeTeam,
                  awayTeam,
                  title: text || `${homeTeam} vs ${awayTeam}`,
                  reportUrl: fullHref
                });
                
                console.log(`✅ Found match link: ${homeTeam} vs ${awayTeam} -> ${fullHref}`);
              }
            }
          });
        }
        
        if (matchCards.length > 0) {
          console.log(`📊 Found ${matchCards.length} match cards from ${url}`);
          return matchCards;
        }
        
      } catch (error) {
        console.log(`❌ Error checking ${url}: ${error.message}`);
        continue;
      }
    }
    
    console.log('❌ No match cards found in any URL');
    return [];
    
  } catch (error) {
    console.error('❌ Error finding match cards:', error.message);
    return [];
  }
}

async function scrapeMatchReportFromCard(reportUrl) {
  try {
    console.log(`📖 Scraping match report from: ${reportUrl}`);
    
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
      matchInfo: {},
      league: '',
      stadium: '',
      date: '',
      time: '',
      found: false
    };
    
    const logoImages = [];
    $('img').each((index, element) => {
      const img = $(element);
      const src = img.attr('src') || img.attr('data-src');
      const alt = img.attr('alt') || '';
      
      if (src && src.includes('wp-content/uploads') && 
          (alt.includes('تحت') || alt.includes('U19') || alt.includes('U20') || alt.includes('U21') || 
           src.includes('/202') || alt.match(/^\w+/))) {
        logoImages.push({ src, alt });
      }
    });
    
    if (logoImages.length >= 2) {
      matchReport.homeTeamLogo = logoImages[0].src;
      matchReport.awayTeamLogo = logoImages[1].src;
      matchReport.homeTeam = logoImages[0].alt || '';
      matchReport.awayTeam = logoImages[1].alt || '';
      console.log(`🏠 Home team logo: ${matchReport.homeTeamLogo}`);
      console.log(`🏃 Away team logo: ${matchReport.awayTeamLogo}`);
    }
    
    const bodyText = $('body').text();
    const scorePatterns = [
      /نتيجة.*?(\w+.*?)\s+(\d+)\s*[-:]\s*(\d+)\s+(\w+.*?)(?:\s|$)/g,
      /النتيجة.*?(\w+.*?)\s+(\d+)\s*[-:]\s*(\d+)\s+(\w+.*?)(?:\s|$)/g,
      /(\w+.*?)\s+(\d+)\s*[-:]\s*(\d+)\s+(\w+.*?)(?:\s+في|\s+بتاريخ|\s+$)/g
    ];
    
    for (const pattern of scorePatterns) {
      let scoreMatch;
      while ((scoreMatch = pattern.exec(bodyText)) !== null) {
        const [, team1, score1, score2, team2] = scoreMatch;
        if (parseInt(score1) >= 0 && parseInt(score2) >= 0) {
          matchReport.homeTeam = matchReport.homeTeam || team1.trim();
          matchReport.awayTeam = matchReport.awayTeam || team2.trim();
          matchReport.homeScore = parseInt(score1);
          matchReport.awayScore = parseInt(score2);
          matchReport.found = true;
          console.log(`⚽ Found score: ${team1} ${score1}-${score2} ${team2}`);
          break;
        }
      }
      if (matchReport.found) break;
    }
    
    const lineupKeywords = ['تشكيل', 'تشكيلة', 'lineup', 'formation', 'starting'];
    const playerPattern = /(\d+)[\s\-\.]*([^0-9\n\r]{3,}?)(?=\d|$|\n|\r)/g;
    
    let lineupSection = '';
    lineupKeywords.forEach(keyword => {
      const keywordIndex = bodyText.toLowerCase().indexOf(keyword);
      if (keywordIndex !== -1) {
        lineupSection = bodyText.substring(keywordIndex, keywordIndex + 2000);
      }
    });
    
    if (lineupSection) {
      let playerMatch;
      let playerCount = 0;
      
      while ((playerMatch = playerPattern.exec(lineupSection)) !== null && playerCount < 22) {
        const [, number, name] = playerMatch;
        const cleanName = name.trim().replace(/[^\w\s\u0600-\u06FF]/g, '');
        
        if (cleanName.length > 2) {
          const player = {
            number: number,
            name: cleanName,
            position: 'لاعب'
          };
          
          if (matchReport.homeLineup.length < 11) {
            matchReport.homeLineup.push(player);
          } else if (matchReport.awayLineup.length < 11) {
            matchReport.awayLineup.push(player);
          }
          
          playerCount++;
        }
      }
      
      console.log(`👥 Found ${matchReport.homeLineup.length} home players, ${matchReport.awayLineup.length} away players`);
    }
    
    const eventKeywords = ['أحداث', 'events', 'timeline', 'incidents'];
    const eventPattern = /(\d+)['′]?\s*([^0-9\n\r]{2,}?)(?=\d+['′]?|\n|\r|$)/g;
    
    let eventsSection = '';
    eventKeywords.forEach(keyword => {
      const keywordIndex = bodyText.toLowerCase().indexOf(keyword);
      if (keywordIndex !== -1) {
        eventsSection = bodyText.substring(keywordIndex, keywordIndex + 1500);
      }
    });
    
    if (eventsSection) {
      let eventMatch;
      while ((eventMatch = eventPattern.exec(eventsSection)) !== null) {
        const [, minute, eventText] = eventMatch;
        const cleanEventText = eventText.trim();
        
        let eventType = 'حدث';
        let eventIcon = '⚽';
        
        if (cleanEventText.includes('هدف') || cleanEventText.includes('goal')) {
          eventType = 'هدف';
          eventIcon = '⚽';
        } else if (cleanEventText.includes('صفراء') || cleanEventText.includes('yellow')) {
          eventType = 'بطاقة صفراء';
          eventIcon = '🟨';
        } else if (cleanEventText.includes('حمراء') || cleanEventText.includes('red')) {
          eventType = 'بطاقة حمراء';
          eventIcon = '🟥';
        } else if (cleanEventText.includes('تبديل') || cleanEventText.includes('sub')) {
          eventType = 'تبديل';
          eventIcon = '🔄';
        }
        
        matchReport.events.push({
          minute: minute,
          player: cleanEventText,
          type: eventType,
          icon: eventIcon
        });
      }
      
      console.log(`📊 Found ${matchReport.events.length} match events`);
    }
    
    const leaguePatterns = [
      /(?:في إطار|البطولة|المسابقة|الدوري)\s*:?\s*([^.\n\r]{5,50})/g,
      /(?:league|championship|cup|tournament)\s*:?\s*([^.\n\r]{5,50})/gi
    ];
    
    for (const pattern of leaguePatterns) {
      const leagueMatch = pattern.exec(bodyText);
      if (leagueMatch) {
        matchReport.league = leagueMatch[1].trim();
        console.log(`🏆 Found league: ${matchReport.league}`);
        break;
      }
    }
    
    console.log(`📋 Match report extracted - Found: ${matchReport.found}, Events: ${matchReport.events.length}, Players: ${matchReport.homeLineup.length + matchReport.awayLineup.length}`);
    
    return matchReport;
    
  } catch (error) {
    console.error(`❌ Error scraping match report from ${reportUrl}:`, error.message);
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
      matchInfo: {},
      league: '',
      found: false
    };
  }
}

function generateRichMatchReport(matchReport, matchCard, dateCategory, publishedDate) {
  const homeTeamName = matchReport.homeTeam || matchCard.homeTeam;
  const awayTeamName = matchReport.awayTeam || matchCard.awayTeam;
  const competition = matchReport.league || 'غير محدد';
  const finalScore = matchReport.found ? `${matchReport.homeScore} - ${matchReport.awayScore}` : 'غير متوفر';
  
  let reportTitle = `تقرير المباراة: ${homeTeamName} ضد ${awayTeamName}`;
  if (competition && competition !== 'غير محدد') {
    reportTitle += ` - ${competition}`;
  }
  
  const headerColor = dateCategory === 'today' ? '#27ae60' : 
                     dateCategory === 'yesterday' ? '#f39c12' : '#95a5a6';
  
  const publishedDateFormatted = new Date(publishedDate).toLocaleDateString('ar-EG', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  const templateVersion = "SPORTLIVE_CARD_REPORT_V1_2025";
  
  const reportContent = `<!-- ${templateVersion} -->
<div class="match-report" style="max-width: 95%; margin: 2% auto; padding: 2%; background: linear-gradient(135deg, #f8f9fa 0%, #ffffff 100%); border-radius: 15px; box-shadow: 0 10px 30px rgba(0,0,0,0.1); font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; border: 1px solid #e9ecef;">
  
  <div class="header" style="text-align: center; margin-bottom: 3%; padding-bottom: 2%; border-bottom: 3px solid ${headerColor};">
    <h1 style="color: #2c3e50; margin: 0; font-size: clamp(20px, 5vw, 28px); font-weight: 700;">
      📊 تقرير المباراة الشامل
    </h1>
    <p style="color: #7f8c8d; margin: 1% 0 0 0; font-size: clamp(14px, 3vw, 16px);">${competition}</p>
  </div>
  
  <div class="score-section" style="background: linear-gradient(135deg, ${headerColor} 0%, #34495e 100%); color: white; padding: 3%; border-radius: 12px; margin-bottom: 3%; text-align: center; box-shadow: 0 8px 20px rgba(0,0,0,0.15);">
    <h2 style="margin: 0 0 2% 0; font-size: clamp(18px, 4vw, 24px); font-weight: 600;">النتيجة النهائية</h2>
    <div style="display: flex; justify-content: center; align-items: center; gap: 3%; flex-wrap: wrap;">
      <div style="text-align: center; flex: 1; min-width: 120px;">
        <div style="width: 60px; height: 60px; border-radius: 50%; margin: 0 auto 2%; display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,0.2); backdrop-filter: blur(10px);">
          ${matchReport.homeTeamLogo ? 
            `<img src="${matchReport.homeTeamLogo}" alt="${homeTeamName}" style="width: 50px; height: 50px; object-fit: contain; border-radius: 50%;">` :
            `<span style="font-size: 24px;">🏠</span>`
          }
        </div>
        <h3 style="margin: 0; font-size: clamp(14px, 3vw, 18px); opacity: 0.9;">${homeTeamName}</h3>
      </div>
      <div style="background: rgba(255,255,255,0.2); padding: 2% 4%; border-radius: 12px; backdrop-filter: blur(10px); min-width: 120px;">
        <span style="font-size: clamp(24px, 8vw, 48px); font-weight: bold; text-shadow: 2px 2px 4px rgba(0,0,0,0.3);">${finalScore}</span>
      </div>
      <div style="text-align: center; flex: 1; min-width: 120px;">
        <div style="width: 60px; height: 60px; border-radius: 50%; margin: 0 auto 2%; display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,0.2); backdrop-filter: blur(10px);">
          ${matchReport.awayTeamLogo ? 
            `<img src="${matchReport.awayTeamLogo}" alt="${awayTeamName}" style="width: 50px; height: 50px; object-fit: contain; border-radius: 50%;">` :
            `<span style="font-size: 24px;">🏃</span>`
          }
        </div>
        <h3 style="margin: 0; font-size: clamp(14px, 3vw, 18px); opacity: 0.9;">${awayTeamName}</h3>
      </div>
    </div>
  </div>

  ${matchReport.events.length > 0 ? `
  <div class="events-section" style="background: white; padding: 3%; border-radius: 12px; margin-bottom: 3%; box-shadow: 0 5px 15px rgba(0,0,0,0.08);">
    <h3 style="color: #2c3e50; margin: 0 0 2% 0; font-size: clamp(18px, 4vw, 22px); display: flex; align-items: center; gap: 2%;">
      <span style="background: ${headerColor}; color: white; width: clamp(30px, 6vw, 40px); height: clamp(30px, 6vw, 40px); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: clamp(14px, 3vw, 18px);">⚽</span>
      أحداث المباراة المهمة
    </h3>
    <div class="events-timeline">
      ${matchReport.events.slice(0, 10).map(event => `
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

  ${matchReport.homeLineup.length > 0 || matchReport.awayLineup.length > 0 ? `
  <div class="lineups-section" style="background: white; padding: 3%; border-radius: 12px; margin-bottom: 3%; box-shadow: 0 5px 15px rgba(0,0,0,0.08);">
    <h3 style="color: #2c3e50; margin: 0 0 2% 0; font-size: clamp(18px, 4vw, 22px); display: flex; align-items: center; gap: 2%;">
      <span style="background: ${headerColor}; color: white; width: clamp(30px, 6vw, 40px); height: clamp(30px, 6vw, 40px); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: clamp(14px, 3vw, 18px);">👥</span>
      تشكيلة الفريقين
    </h3>
    
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 3%; margin-top: 2%;">
      ${matchReport.homeLineup.length > 0 ? `
      <div style="padding: 3%; background: linear-gradient(135deg, #e8f5e8 0%, #c8e6c9 100%); border-radius: 10px; border-left: 4px solid #4caf50;">
        <h4 style="margin: 0 0 2% 0; color: #2e7d32; font-size: clamp(16px, 3.5vw, 20px); text-align: center;">${homeTeamName}</h4>
        ${matchReport.homeLineup.slice(0, 11).map(player => `
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
      
      ${matchReport.awayLineup.length > 0 ? `
      <div style="padding: 3%; background: linear-gradient(135deg, #ffebee 0%, #ffcdd2 100%); border-radius: 10px; border-left: 4px solid #f44336;">
        <h4 style="margin: 0 0 2% 0; color: #c62828; font-size: clamp(16px, 3.5vw, 20px); text-align: center;">${awayTeamName}</h4>
        ${matchReport.awayLineup.slice(0, 11).map(player => `
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
  
  <div class="match-info" style="background: white; padding: 3%; border-radius: 12px; margin-bottom: 3%; box-shadow: 0 5px 15px rgba(0,0,0,0.08); width: 100%;">
    <h3 style="color: #2c3e50; margin: 0 0 2% 0; font-size: clamp(18px, 4vw, 22px); display: flex; align-items: center; gap: 2%;">
      <span style="background: ${headerColor}; color: white; width: clamp(30px, 6vw, 40px); height: clamp(30px, 6vw, 40px); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: clamp(14px, 3vw, 18px);">📋</span>
      معلومات المباراة
    </h3>
    
    <div style="display: block; width: 100%;">
      <div style="padding: 3%; background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%); border-radius: 10px; border-left: 4px solid ${headerColor}; margin-bottom: 2%; width: 100%;">
        <div style="display: flex; align-items: center; gap: 2%; margin-bottom: 1%;">
          <span style="font-size: clamp(16px, 4vw, 20px);">🏆</span>
          <strong style="color: #2c3e50; font-size: clamp(14px, 3vw, 16px);">البطولة</strong>
        </div>
        <p style="margin: 0; color: #34495e; font-size: clamp(13px, 2.8vw, 15px);">${competition}</p>
      </div>
      
      <div style="padding: 3%; background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%); border-radius: 10px; border-left: 4px solid ${headerColor}; margin-bottom: 2%; width: 100%;">
        <div style="display: flex; align-items: center; gap: 2%; margin-bottom: 1%;">
          <span style="font-size: clamp(16px, 4vw, 20px);">📅</span>
          <strong style="color: #2c3e50; font-size: clamp(14px, 3vw, 16px);">التاريخ</strong>
        </div>
        <p style="margin: 0; color: #34495e; font-size: clamp(13px, 2.8vw, 15px);">${publishedDateFormatted}</p>
      </div>
      
      <div style="padding: 3%; background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%); border-radius: 10px; border-left: 4px solid ${headerColor}; margin-bottom: 2%; width: 100%;">
        <div style="display: flex; align-items: center; gap: 2%; margin-bottom: 1%;">
          <span style="font-size: clamp(16px, 4vw, 20px);">🔄</span>
          <strong style="color: #2c3e50; font-size: clamp(14px, 3vw, 16px);">آخر تحديث</strong>
        </div>
        <p style="margin: 0; color: #34495e; font-size: clamp(13px, 2.8vw, 15px);">${new Date().toLocaleDateString('ar-EG')}، ${new Date().toLocaleTimeString('ar-EG')}</p>
      </div>
      
      <div style="padding: 3%; background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%); border-radius: 10px; border-left: 4px solid ${headerColor}; margin-bottom: 2%; width: 100%;">
        <div style="display: flex; align-items: center; gap: 2%; margin-bottom: 1%;">
          <span style="font-size: clamp(16px, 4vw, 20px);">🎯</span>
          <strong style="color: #2c3e50; font-size: clamp(14px, 3vw, 16px);">النتيجة</strong>
        </div>
        <p style="margin: 0; color: #34495e; font-size: clamp(13px, 2.8vw, 15px);">${finalScore}</p>
      </div>
      
      <div style="padding: 3%; background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%); border-radius: 10px; border-left: 4px solid ${headerColor}; margin-bottom: 2%; width: 100%;">
        <div style="display: flex; align-items: center; gap: 2%; margin-bottom: 1%;">
          <span style="font-size: clamp(16px, 4vw, 20px);">📊</span>
          <strong style="color: #2c3e50; font-size: clamp(14px, 3vw, 16px);">أحداث المباراة</strong>
        </div>
        <p style="margin: 0; color: #34495e; font-size: clamp(13px, 2.8vw, 15px);">${matchReport.events.length} حدث</p>
      </div>
    </div>
  </div>
  
  <div style="background: linear-gradient(135deg, #fff3cd 0%, #ffeaa7 100%); padding: 3%; border-radius: 12px; margin-bottom: 3%; border-left: 4px solid #f39c12;">
    <h3 style="color: #856404; margin: 0 0 2% 0; font-size: clamp(16px, 3.5vw, 20px); display: flex; align-items: center; gap: 2%;">
      <span style="background: #f39c12; color: white; width: clamp(28px, 5.5vw, 36px); height: clamp(28px, 5.5vw, 36px); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: clamp(12px, 2.5vw, 16px);">🎯</span>
      معلومات عامة
    </h3>
    <div style="color: #856404; line-height: 1.6; font-size: clamp(14px, 3vw, 16px);">
      <p style="margin: 0 0 2% 0;">
        <strong>انتهت المباراة</strong> بين فريق <strong>${homeTeamName}</strong> وفريق <strong>${awayTeamName}</strong> 
        في إطار منافسات <strong>${competition}</strong>
        ${matchReport.found ? ` بنتيجة <strong style="color: #f39c12;">${finalScore}</strong>` : ''}.
      </p>
      <p style="margin: 0; font-weight: 600;">
        للحصول على النتائج التفصيلية والملخص الكامل، يرجى متابعة القنوات الرياضية المختصة.
      </p>
    </div>
  </div>
  
  <div style="background: linear-gradient(135deg, #d4edda 0%, #c3e6cb 100%); padding: 3%; border-radius: 12px; border-left: 4px solid #28a745; margin-bottom: 3%;">
    <h3 style="color: #155724; margin: 0 0 2% 0; font-size: clamp(16px, 3.5vw, 20px); display: flex; align-items: center; gap: 2%;">
      <span style="background: #28a745; color: white; width: clamp(28px, 5.5vw, 36px); height: clamp(28px, 5.5vw, 36px); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: clamp(12px, 2.5vw, 16px);">🔔</span>
      ملاحظة مهمة
    </h3>
    <p style="margin: 0; color: #155724; font-size: clamp(13px, 2.8vw, 15px); line-height: 1.6;">
      هذا تقرير تلقائي يتم إنشاؤه لأرشفة معلومات المباراة. للحصول على النتائج الدقيقة والتفاصيل الكاملة، يرجى متابعة القنوات الرياضية الرسمية أو المواقع المتخصصة.
    </p>
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

<!-- Template Version: SPORTLIVE_CARD_REPORT_V1_2025 -->
<!-- Generated with KooraLiveTV Card Report Scraper -->
<!-- Real Match Data from Card Links -->`;

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

function extractTeamsFromTitle(title) {
  let cleanTitle = title.replace(/تقرير المباراة:\s*/g, '').trim();
  console.log(`🧹 Cleaned title: "${cleanTitle}"`);
  
  const patterns = [
    /(.+?)\s+(?:vs|ضد)\s+(.+?)(?:\s+-\s+(.+))?$/i,
    /(.+?)\s+(?:vs|ضد)\s+(.+)/i,
    /^(.+?)\s+-\s+(.+?)\s+-\s+(.+)$/
  ];
  
  for (const pattern of patterns) {
    const match = cleanTitle.match(pattern);
    if (match) {
      console.log(`✅ Pattern matched: ${pattern}`);
      return {
        homeTeam: match[1].trim(),
        awayTeam: match[2].trim(),
        league: match[3] ? match[3].trim() : ''
      };
    }
  }
  
  console.log(`❌ No pattern matched for title: "${cleanTitle}"`);
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
  } else if (publishedDay.getTime() < yesterday.getTime()) {
    return 'older';
  } else {
    return 'future';
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

async function processYesterdayMatchCards() {
  try {
    console.log('🚀 Starting KooraLiveTV Card Link Scraper...');
    
    if (!BLOG_ID || !API_KEY || !ACCESS_TOKEN) {
      console.error('❌ Missing required environment variables');
      process.exit(1);
    }
    
    const matchCards = await findYesterdayMatchCards();
    
    if (matchCards.length === 0) {
      console.log('❌ No match cards found');
      return;
    }
    
    console.log(`📊 Found ${matchCards.length} match cards, starting report extraction...`);
    
    let processedCount = 0;
    let errorCount = 0;
    
    for (const matchCard of matchCards.slice(0, 5)) { 
      try {
        console.log(`\n📋 Processing card: ${matchCard.title}`);
        console.log(`🔗 Report URL: ${matchCard.reportUrl}`);
        
        const matchReport = await scrapeMatchReportFromCard(matchCard.reportUrl);
        
        const report = generateRichMatchReport(matchReport, matchCard, 'yesterday', new Date());
        
        console.log(`📝 Generated report: ${report.title}`);
        console.log(`📊 Data extracted: Score ${matchReport.found ? 'YES' : 'NO'}, Events: ${matchReport.events.length}, Lineups: ${matchReport.homeLineup.length + matchReport.awayLineup.length}, Logos: ${matchReport.homeTeamLogo ? 'YES' : 'NO'}`);
        
        const allPosts = await getAllBlogPosts();
        const matchPosts = allPosts.filter(post => isMatchPost(post.title));
        
        let existingPost = null;
        for (const post of matchPosts) {
          const teamInfo = extractTeamsFromTitle(post.title);
          if (teamInfo && 
              (teamInfo.homeTeam.includes(matchCard.homeTeam.substring(0, 8)) || 
               teamInfo.awayTeam.includes(matchCard.awayTeam.substring(0, 8)))) {
            existingPost = post;
            break;
          }
        }
        
        if (existingPost) {
          console.log(`🔄 Updating existing post: ${existingPost.title}`);
          const success = await updatePost(existingPost.id, report.title, report.content);
          if (success) {
            console.log(`✅ Successfully updated post with real match data`);
          }
        } else {
          console.log(`📝 No existing post found for this match - would create new post`);
        }
        
        processedCount++;
        
        console.log('⏳ Waiting 15 seconds...');
        await new Promise(resolve => setTimeout(resolve, 15000));
        
      } catch (error) {
        console.error(`❌ Error processing ${matchCard.title}:`, error.message);
        errorCount++;
      }
    }
    
    console.log(`\n🎉 Card Processing Complete!`);
    console.log(`   ✅ Processed: ${processedCount} matches`);
    console.log(`   ❌ Errors: ${errorCount} matches`);
    
  } catch (error) {
    console.error('💥 Error in processYesterdayMatchCards:', error);
    process.exit(1);
  }
}

processYesterdayMatchCards();
