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

async function scrapeYesterdayMatches() {
  try {
    console.log('🔍 Fetching yesterday matches from KooraLiveTV...');
    
    const response = await axios.get('https://www.kooralivetv.com/matches-yesterday/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 15000
    });
    
    const $ = cheerio.load(response.data);
    const matchCards = [];
    
    const cardSelectors = [
      '.match-card',
      '.match-item', 
      '.game-card',
      '.fixture',
      '.match',
      'article',
      '.post',
      '[data-match]',
      '.match-container'
    ];
    
    for (const selector of cardSelectors) {
      const cards = $(selector);
      if (cards.length > 0) {
        console.log(`✅ Found ${cards.length} cards with selector: ${selector}`);
        
        cards.each((index, element) => {
          const card = $(element);
          
          let matchLink = card.find('a').first().attr('href');
          if (matchLink && !matchLink.startsWith('http')) {
            matchLink = 'https://www.kooralivetv.com' + matchLink;
          }
          
          const teamElements = card.find('.team, .club, .team-name, h3, h2, strong').toArray();
          let homeTeam = '';
          let awayTeam = '';
          
          if (teamElements.length >= 2) {
            homeTeam = $(teamElements[0]).text().trim();
            awayTeam = $(teamElements[1]).text().trim();
          }
          
          let score = '';
          const scoreSelectors = ['.score', '.result', '.final-score', '.match-score'];
          for (const scoreSelector of scoreSelectors) {
            const scoreEl = card.find(scoreSelector);
            if (scoreEl.length > 0) {
              score = scoreEl.text().trim();
              break;
            }
          }
          
          let league = '';
          const leagueSelectors = ['.league', '.tournament', '.competition', '.league-name'];
          for (const leagueSelector of leagueSelectors) {
            const leagueEl = card.find(leagueSelector);
            if (leagueEl.length > 0) {
              league = leagueEl.text().trim();
              break;
            }
          }
          
          if (matchLink && homeTeam && awayTeam) {
            matchCards.push({
              homeTeam,
              awayTeam,
              score,
              league,
              link: matchLink,
              title: `${homeTeam} vs ${awayTeam}${league ? ' - ' + league : ''}`
            });
          }
        });
        break;
      }
    }
    
    if (matchCards.length === 0) {
      console.log('🔄 No cards found, trying fallback method...');
      
      $('a').each((index, element) => {
        const link = $(element);
        const href = link.attr('href');
        const text = link.text().trim();
        
        if (href && text && 
            (href.includes('/match') || href.includes('/game') || href.includes('vs') || text.includes('vs') || text.includes('ضد'))) {
          
          let fullLink = href;
          if (!fullLink.startsWith('http')) {
            fullLink = 'https://www.kooralivetv.com' + fullLink;
          }
          
          const vsMatch = text.match(/(.+?)\s+(?:vs|ضد)\s+(.+)/i);
          if (vsMatch) {
            matchCards.push({
              homeTeam: vsMatch[1].trim(),
              awayTeam: vsMatch[2].trim(),
              score: '',
              league: '',
              link: fullLink,
              title: text
            });
          }
        }
      });
    }
    
    console.log(`📊 Found ${matchCards.length} match cards`);
    return matchCards;
    
  } catch (error) {
    console.error('❌ Error scraping yesterday matches:', error.message);
    return [];
  }
}

async function scrapeMatchReport(matchUrl) {
  try {
    console.log(`📖 Scraping match report from: ${matchUrl}`);
    
    const response = await axios.get(matchUrl, {
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
      summary: '',
      found: false
    };
    
    $('img').each((index, element) => {
      const img = $(element);
      const src = img.attr('src') || img.attr('data-src');
      const alt = img.attr('alt') || '';
      
      if (src && src.includes('kooralivetv.com') && !src.includes('event')) {
        if (!matchReport.homeTeamLogo) {
          matchReport.homeTeamLogo = src;
        } else if (!matchReport.awayTeamLogo && src !== matchReport.homeTeamLogo) {
          matchReport.awayTeamLogo = src;
        }
      }
    });
    
    const bodyText = $('body').text();
    const scoreRegex = /(\w+)\s+(\d+)\s*[-:]\s*(\d+)\s+(\w+)/g;
    let scoreMatch;
    while ((scoreMatch = scoreRegex.exec(bodyText)) !== null) {
      matchReport.homeTeam = scoreMatch[1];
      matchReport.homeScore = parseInt(scoreMatch[2]);
      matchReport.awayScore = parseInt(scoreMatch[3]);
      matchReport.awayTeam = scoreMatch[4];
      matchReport.found = true;
      break;
    }
    
    const lineupSelectors = ['.lineup', '.team-lineup', '.players', '.formation'];
    for (const selector of lineupSelectors) {
      const lineupSection = $(selector);
      if (lineupSection.length > 0) {
        lineupSection.find('.player, .player-name').each((index, playerEl) => {
          const playerName = $(playerEl).text().trim();
          const playerNumber = $(playerEl).find('.number').text().trim() || (index + 1).toString();
          
          if (playerName) {
            const player = {
              number: playerNumber,
              name: playerName,
              position: 'لاعب'
            };
            
            if (matchReport.homeLineup.length < 11) {
              matchReport.homeLineup.push(player);
            } else if (matchReport.awayLineup.length < 11) {
              matchReport.awayLineup.push(player);
            }
          }
        });
      }
    }
    
    const eventSelectors = ['.events', '.match-events', '.timeline', '.incidents'];
    for (const selector of eventSelectors) {
      const eventsSection = $(selector);
      if (eventsSection.length > 0) {
        eventsSection.find('.event, .incident, .match-event').each((index, eventEl) => {
          const eventElement = $(eventEl);
          const minute = eventElement.find('.minute, .time').text().trim() || '0';
          const player = eventElement.find('.player, .player-name').text().trim() || 'لاعب';
          const eventType = eventElement.find('.type, .event-type').text().trim() || eventElement.text().trim();
          
          let icon = '⚽';
          let type = 'حدث';
          
          if (eventType.includes('goal') || eventType.includes('هدف')) {
            icon = '⚽';
            type = 'هدف';
          } else if (eventType.includes('yellow') || eventType.includes('صفراء')) {
            icon = '🟨';
            type = 'بطاقة صفراء';
          } else if (eventType.includes('red') || eventType.includes('حمراء')) {
            icon = '🟥';
            type = 'بطاقة حمراء';
          } else if (eventType.includes('sub') || eventType.includes('تبديل')) {
            icon = '🔄';
            type = 'تبديل';
          }
          
          matchReport.events.push({
            minute,
            player,
            type,
            icon
          });
        });
      }
    }
    
    const summarySelectors = ['.summary', '.match-summary', '.description', '.content'];
    for (const selector of summarySelectors) {
      const summaryEl = $(selector);
      if (summaryEl.length > 0) {
        matchReport.summary = summaryEl.text().trim();
        break;
      }
    }
    
    console.log(`📊 Report extracted: ${matchReport.events.length} events, ${matchReport.homeLineup.length + matchReport.awayLineup.length} players`);
    
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
      matchInfo: {},
      summary: '',
      found: false
    };
  }
}

function generateRichMatchReport(matchReport, matchCard) {
  const {
    homeTeam,
    awayTeam,
    homeScore,
    awayScore,
    homeTeamLogo,
    awayTeamLogo,
    homeLineup,
    awayLineup,
    events,
    summary,
    found
  } = matchReport;
  
  const reportTitle = `تقرير المباراة: ${matchCard.homeTeam} ضد ${matchCard.awayTeam}${matchCard.league ? ' - ' + matchCard.league : ''}`;
  const headerColor = '#f39c12';
  const finalScore = found ? `${homeScore} - ${awayScore}` : (matchCard.score || 'غير متوفر');
  
  const content = `<!-- KOORALIVETV_SCRAPER_V1_2025 -->
<div class="match-report" style="max-width: 95%; margin: 2% auto; padding: 2%; background: linear-gradient(135deg, #f8f9fa 0%, #ffffff 100%); border-radius: 15px; box-shadow: 0 10px 30px rgba(0,0,0,0.1); font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
  
  <div class="header" style="text-align: center; margin-bottom: 3%; padding-bottom: 2%; border-bottom: 3px solid ${headerColor};">
    <h1 style="color: #2c3e50; margin: 0; font-size: clamp(20px, 5vw, 28px); font-weight: 700;">
      📊 تقرير المباراة الشامل
    </h1>
    <p style="color: #7f8c8d; margin: 1% 0 0 0; font-size: clamp(14px, 3vw, 16px);">${matchCard.league || 'مباراة كرة قدم'}</p>
  </div>
  
  <div class="score-section" style="background: linear-gradient(135deg, ${headerColor} 0%, #34495e 100%); color: white; padding: 3%; border-radius: 12px; margin-bottom: 3%; text-align: center;">
    <h2 style="margin: 0 0 2% 0; font-size: clamp(18px, 4vw, 24px);">النتيجة النهائية</h2>
    <div style="display: flex; justify-content: center; align-items: center; gap: 3%; flex-wrap: wrap;">
      <div style="text-align: center; flex: 1; min-width: 120px;">
        <div style="width: 60px; height: 60px; border-radius: 50%; margin: 0 auto 2%; display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,0.2);">
          ${homeTeamLogo ? 
            `<img src="${homeTeamLogo}" alt="${homeTeam || matchCard.homeTeam}" style="width: 50px; height: 50px; object-fit: contain; border-radius: 50%;">` :
            `<span style="font-size: 24px;">🏠</span>`
          }
        </div>
        <h3 style="margin: 0; font-size: clamp(14px, 3vw, 18px);">${homeTeam || matchCard.homeTeam}</h3>
      </div>
      <div style="background: rgba(255,255,255,0.2); padding: 2% 4%; border-radius: 12px; min-width: 120px;">
        <span style="font-size: clamp(24px, 8vw, 48px); font-weight: bold;">${finalScore}</span>
      </div>
      <div style="text-align: center; flex: 1; min-width: 120px;">
        <div style="width: 60px; height: 60px; border-radius: 50%; margin: 0 auto 2%; display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,0.2);">
          ${awayTeamLogo ? 
            `<img src="${awayTeamLogo}" alt="${awayTeam || matchCard.awayTeam}" style="width: 50px; height: 50px; object-fit: contain; border-radius: 50%;">` :
            `<span style="font-size: 24px;">🏃</span>`
          }
        </div>
        <h3 style="margin: 0; font-size: clamp(14px, 3vw, 18px);">${awayTeam || matchCard.awayTeam}</h3>
      </div>
    </div>
  </div>

  ${events.length > 0 ? `
  <div class="events-section" style="background: white; padding: 3%; border-radius: 12px; margin-bottom: 3%; box-shadow: 0 5px 15px rgba(0,0,0,0.08);">
    <h3 style="color: #2c3e50; margin: 0 0 2% 0; font-size: clamp(18px, 4vw, 22px); display: flex; align-items: center; gap: 2%;">
      <span style="background: ${headerColor}; color: white; width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center;">⚽</span>
      أحداث المباراة
    </h3>
    ${events.slice(0, 10).map(event => `
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

  <div class="match-info" style="background: white; padding: 3%; border-radius: 12px; margin-bottom: 3%; box-shadow: 0 5px 15px rgba(0,0,0,0.08); width: 100%;">
    <h3 style="color: #2c3e50; margin: 0 0 2% 0; font-size: clamp(18px, 4vw, 22px); display: flex; align-items: center; gap: 2%;">
      <span style="background: ${headerColor}; color: white; width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center;">📋</span>
      معلومات المباراة
    </h3>
    
    <div style="display: block; width: 100%;">
      <div style="padding: 3%; background: #f8f9fa; border-radius: 10px; border-left: 4px solid ${headerColor}; margin-bottom: 2%; width: 100%;">
        <div style="display: flex; align-items: center; gap: 2%; margin-bottom: 1%;">
          <span style="font-size: 20px;">🏆</span>
          <strong style="color: #2c3e50;">البطولة</strong>
        </div>
        <p style="margin: 0; color: #34495e;">${matchCard.league || 'غير محدد'}</p>
      </div>
      
      <div style="padding: 3%; background: #f8f9fa; border-radius: 10px; border-left: 4px solid ${headerColor}; margin-bottom: 2%; width: 100%;">
        <div style="display: flex; align-items: center; gap: 2%; margin-bottom: 1%;">
          <span style="font-size: 20px;">📅</span>
          <strong style="color: #2c3e50;">التاريخ</strong>
        </div>
        <p style="margin: 0; color: #34495e;">${new Date().toLocaleDateString('ar-EG')}</p>
      </div>
      
      <div style="padding: 3%; background: #f8f9fa; border-radius: 10px; border-left: 4px solid ${headerColor}; margin-bottom: 2%; width: 100%;">
        <div style="display: flex; align-items: center; gap: 2%; margin-bottom: 1%;">
          <span style="font-size: 20px;">🔄</span>
          <strong style="color: #2c3e50;">آخر تحديث</strong>
        </div>
        <p style="margin: 0; color: #34495e;">${new Date().toLocaleDateString('ar-EG')}، ${new Date().toLocaleTimeString('ar-EG')}</p>
      </div>
    </div>
  </div>
  
  <div style="background: #fff3cd; padding: 3%; border-radius: 12px; margin-bottom: 3%; border-left: 4px solid #ffc107;">
    <h3 style="color: #856404; margin: 0 0 2% 0; font-size: clamp(16px, 3.5vw, 20px); display: flex; align-items: center; gap: 2%;">
      <span style="background: #ffc107; color: white; width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center;">🎯</span>
      معلومات عامة
    </h3>
    <p style="margin: 0 0 2% 0; color: #856404; line-height: 1.6;">
      <strong>انتهت مباراة الأمس</strong> بين <strong>${matchCard.homeTeam}</strong> و <strong>${matchCard.awayTeam}</strong> في إطار <strong>${matchCard.league || 'البطولة'}</strong>.
    </p>
    <p style="margin: 0; font-weight: 600; color: #856404;">
      للحصول على النتائج التفصيلية والملخص الكامل، يرجى متابعة القنوات الرياضية المختصة.
    </p>
  </div>
  
  <div style="background: #d4edda; padding: 3%; border-radius: 12px; border-left: 4px solid #28a745;">
    <h3 style="color: #155724; margin: 0 0 2% 0; font-size: clamp(16px, 3.5vw, 20px); display: flex; align-items: center; gap: 2%;">
      <span style="background: #28a745; color: white; width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center;">🔔</span>
      ملاحظة مهمة
    </h3>
    <p style="margin: 0; color: #155724; line-height: 1.6;">
      هذا تقرير تلقائي يتم إنشاؤه لأرشفة معلومات المباراة. للحصول على النتائج الدقيقة والتفاصيل الكاملة، يرجى متابعة القنوات الرياضية الرسمية أو المواقع المتخصصة.
    </p>
  </div>
  
</div>`;

  return {
    title: reportTitle,
    content
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

async function processYesterdayMatches() {
  try {
    console.log('🚀 Starting KooraLiveTV Yesterday Matches Scraper...');
    
    if (!BLOG_ID || !API_KEY || !ACCESS_TOKEN) {
      console.error('❌ Missing required environment variables');
      process.exit(1);
    }
    
    const matchCards = await scrapeYesterdayMatches();
    
    if (matchCards.length === 0) {
      console.log('❌ No match cards found');
      return;
    }
    
    console.log(`📊 Processing ${matchCards.length} match cards`);
    
    let processedCount = 0;
    let errorCount = 0;
    
    for (const matchCard of matchCards) {
      try {
        console.log(`\n📋 Processing: ${matchCard.title}`);
        
        const matchReport = await scrapeMatchReport(matchCard.link);
        
        const report = generateRichMatchReport(matchReport, matchCard);
        
        console.log(`📝 Generated report: ${report.title}`);
        console.log(`📊 Data found: Score ${matchReport.found ? 'YES' : 'NO'}, Events: ${matchReport.events.length}, Lineups: ${matchReport.homeLineup.length + matchReport.awayLineup.length}`);
        
 
        processedCount++;
        
        console.log('⏳ Waiting 10 seconds...');
        await new Promise(resolve => setTimeout(resolve, 10000));
        
      } catch (error) {
        console.error(`❌ Error processing ${matchCard.title}:`, error.message);
        errorCount++;
      }
    }
    
    console.log(`\n🎉 Processing Complete!`);
    console.log(`   ✅ Processed: ${processedCount} matches`);
    console.log(`   ❌ Errors: ${errorCount} matches`);
    
  } catch (error) {
    console.error('💥 Error in processYesterdayMatches:', error);
    process.exit(1);
  }
}

processYesterdayMatches();
