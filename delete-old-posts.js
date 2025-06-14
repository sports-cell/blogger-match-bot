const axios = require('axios');
const fs = require('fs').promises;
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
    console.log('No URL mappings file found');
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

async function searchMatchOnKooraLiveTV(homeTeam, awayTeam) {
  try {
    const searchUrls = [
      'https://www.kooralivetv.com/matches/',
      'https://www.kooralivetv.com/',
      'https://www.kooralivetv.com/yesterday-matches/',
      'https://www.kooralivetv.com/matches-yesterday/'
    ];
    
    for (const baseUrl of searchUrls) {
      try {
        console.log(`Searching on: ${baseUrl}`);
        const response = await axios.get(baseUrl, {
          timeout: 10000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        });
        
        const $ = cheerio.load(response.data);
        
        const matchSelectors = [
          '.AY_Match',
          '.match',
          '.match-item',
          '.match-card',
          '.game',
          '.fixture'
        ];
        
        let matchElements = [];
        for (const selector of matchSelectors) {
          matchElements = $(selector);
          if (matchElements.length > 0) {
            console.log(`Found ${matchElements.length} matches using selector: ${selector}`);
            break;
          }
        }
        
        for (let i = 0; i < matchElements.length; i++) {
          const matchEl = $(matchElements[i]);
          
          const team1Text = matchEl.find('.TM1 .TM_Name, .home-team .team-name, .team1').text().trim();
          const team2Text = matchEl.find('.TM2 .TM_Name, .away-team .team-name, .team2').text().trim();
          
          if (team1Text && team2Text) {
            const isMatch = (
              (team1Text.toLowerCase().includes(homeTeam.toLowerCase()) && 
               team2Text.toLowerCase().includes(awayTeam.toLowerCase())) ||
              (team1Text.toLowerCase().includes(awayTeam.toLowerCase()) && 
               team2Text.toLowerCase().includes(homeTeam.toLowerCase()))
            );
            
            if (isMatch) {
              const scoreEl = matchEl.find('.MT_Result, .match-score, .score');
              const statusEl = matchEl.find('.MT_Stat, .match-status, .status');
              const leagueEl = matchEl.find('.MT_Info li:last-child span, .league, .competition');
              
              const scoreText = scoreEl.text().trim();
              const statusText = statusEl.text().trim();
              const leagueText = leagueEl.text().trim();
              
              let homeScore = 0, awayScore = 0;
              const scoreMatch = scoreText.match(/(\d+)\s*[-:]\s*(\d+)/);
              if (scoreMatch) {
                homeScore = parseInt(scoreMatch[1]);
                awayScore = parseInt(scoreMatch[2]);
              }
              
              console.log(`Found match: ${team1Text} vs ${team2Text} - ${scoreText}`);
              
              return {
                homeTeam: team1Text,
                awayTeam: team2Text,
                homeScore,
                awayScore,
                status: statusText,
                league: leagueText,
                finalScore: scoreText,
                found: true
              };
            }
          }
        }
      } catch (error) {
        console.warn(`Error searching ${baseUrl}:`, error.message);
        continue;
      }
    }
    
    return { found: false };
  } catch (error) {
    console.error('Error searching for match:', error);
    return { found: false };
  }
}

function generateMatchReport(matchData, originalTitle) {
  const { homeTeam, awayTeam, homeScore, awayScore, status, league, finalScore } = matchData;
  
  const isFinished = status.includes('انتهت') || status.includes('finished') || finalScore;
  
  let reportTitle = `تقرير المباراة: ${homeTeam} ضد ${awayTeam}`;
  if (league) {
    reportTitle += ` - ${league}`;
  }
  
  const reportContent = `
<div class="match-report" style="max-width: 800px; margin: 20px auto; padding: 20px; background: #f8f9fa; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
  <h2 style="text-align: center; color: #2c3e50; margin-bottom: 30px; border-bottom: 3px solid #3498db; padding-bottom: 15px;">
    📊 تقرير المباراة
  </h2>
  
  <div class="match-header" style="text-align: center; margin-bottom: 30px;">
    <h3 style="color: #34495e; margin-bottom: 10px;">${league || 'مباراة كرة قدم'}</h3>
    <div class="teams-display" style="display: flex; justify-content: center; align-items: center; gap: 20px; margin: 20px 0;">
      <div class="team" style="text-align: center; flex: 1;">
        <h4 style="color: #2980b9; margin-bottom: 10px; font-size: 18px;">${homeTeam}</h4>
        <div class="score" style="font-size: 48px; font-weight: bold; color: #27ae60;">${homeScore || 0}</div>
      </div>
      <div class="vs" style="font-size: 24px; color: #7f8c8d; font-weight: bold;">VS</div>
      <div class="team" style="text-align: center; flex: 1;">
        <h4 style="color: #2980b9; margin-bottom: 10px; font-size: 18px;">${awayTeam}</h4>
        <div class="score" style="font-size: 48px; font-weight: bold; color: #27ae60;">${awayScore || 0}</div>
      </div>
    </div>
  </div>
  
  <div class="match-status" style="text-align: center; margin-bottom: 30px;">
    <span style="display: inline-block; padding: 10px 20px; background: ${isFinished ? '#27ae60' : '#f39c12'}; color: white; border-radius: 25px; font-weight: bold;">
      ${isFinished ? '✅ انتهت المباراة' : '⏰ ' + status}
    </span>
  </div>
  
  ${finalScore ? `
  <div class="final-result" style="text-align: center; margin: 20px 0; padding: 15px; background: #ecf0f1; border-radius: 8px;">
    <h4 style="color: #2c3e50; margin-bottom: 10px;">النتيجة النهائية</h4>
    <div style="font-size: 24px; font-weight: bold; color: #27ae60;">${finalScore}</div>
  </div>
  ` : ''}
  
  <div class="match-info" style="background: white; padding: 20px; border-radius: 8px; margin-top: 20px;">
    <h4 style="color: #2c3e50; margin-bottom: 15px; border-bottom: 2px solid #3498db; padding-bottom: 5px;">
      📋 معلومات المباراة
    </h4>
    <ul style="list-style: none; padding: 0;">
      <li style="margin-bottom: 10px; padding: 8px; background: #f8f9fa; border-radius: 5px;">
        <strong>البطولة:</strong> ${league || 'غير محدد'}
      </li>
      <li style="margin-bottom: 10px; padding: 8px; background: #f8f9fa; border-radius: 5px;">
        <strong>الحالة:</strong> ${status}
      </li>
      <li style="margin-bottom: 10px; padding: 8px; background: #f8f9fa; border-radius: 5px;">
        <strong>تاريخ التحديث:</strong> ${new Date().toLocaleString('ar-EG')}
      </li>
    </ul>
  </div>
  
  <div class="match-highlights" style="margin-top: 20px; padding: 15px; background: #e8f5e8; border-left: 4px solid #27ae60; border-radius: 5px;">
    <h4 style="color: #27ae60; margin-bottom: 10px;">🎯 ملخص المباراة</h4>
    <p style="color: #2c3e50; line-height: 1.6;">
      ${isFinished ? 
        `انتهت المباراة بنتيجة ${finalScore || `${homeScore}-${awayScore}`} ${homeScore > awayScore ? 'لصالح ' + homeTeam : awayScore > homeScore ? 'لصالح ' + awayTeam : 'بالتعادل'}.` :
        'المباراة قيد المتابعة، سيتم تحديث النتائج تلقائياً.'
      }
    </p>
  </div>
  
  <div class="disclaimer" style="margin-top: 20px; padding: 10px; background: #fff3cd; border: 1px solid #ffeaa7; border-radius: 5px; font-size: 12px; color: #856404;">
    <strong>ملاحظة:</strong> يتم تحديث المعلومات تلقائياً من مصادر موثوقة. في حالة وجود أي تضارب في النتائج، يرجى التحقق من المصادر الرسمية.
  </div>
</div>

<script>
// Auto-refresh for live matches
if (!${isFinished}) {
  setTimeout(function() {
    location.reload();
  }, 300000); // Refresh every 5 minutes for live matches
}
</script>
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
    console.log(`Successfully updated post ${postId}`);
    return true;
  } catch (error) {
    console.error(`Error updating post ${postId}:`, error.response?.data || error.message);
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
    console.log('Starting to update match posts with reports...');
    
    if (!BLOG_ID || !API_KEY || !ACCESS_TOKEN) {
      console.error('Missing required environment variables');
      console.error('Required: BLOG_ID, API_KEY, ACCESS_TOKEN');
      process.exit(1);
    }
    
    console.log('All required environment variables found');
    console.log(`Blog ID: ${BLOG_ID}`);
    
    let urlMappings = await loadUrlMappings();
    let allPosts = await getAllBlogPosts();
    
    if (allPosts.length === 0) {
      console.log('No posts found to process');
      return;
    }
    
    const matchPosts = allPosts.filter(post => isMatchPost(post.title));
    console.log(`Found ${matchPosts.length} match posts out of ${allPosts.length} total posts`);
    
    let updatedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    const updatedMappings = { ...urlMappings };
    
    for (const post of matchPosts) {
      console.log(`\nProcessing: ${post.title}`);
      console.log(`Published: ${new Date(post.published).toLocaleString()}`);
      
      if (post.title.includes('تقرير المباراة') || post.content.includes('match-report')) {
        console.log('Post is already a match report, skipping...');
        skippedCount++;
        continue;
      }
      
      const postAge = (new Date() - new Date(post.published)) / (1000 * 60 * 60);
      console.log(`Post age: ${postAge.toFixed(1)} hours`);
      
      let shouldUpdate = false;
      let reason = '';
      
      if (postAge > 24) {
        shouldUpdate = true;
        reason = `Post is ${postAge.toFixed(1)} hours old (>24h)`;
      } else {
        const timeMatch = post.content?.match(/⏰\s*(\d{1,2}:\d{2}(?:\s*[AP]M)?)/i);
        const matchTime = timeMatch ? timeMatch[1] : null;
        
        if (matchTime) {
          const isFinished = isMatchFinished(matchTime, post.published);
          if (isFinished) {
            shouldUpdate = true;
            reason = `Match at ${matchTime} is finished`;
          } else {
            reason = `Match at ${matchTime} is still current/future`;
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
      
      console.log(`Decision: ${shouldUpdate ? 'UPDATE' : 'KEEP'} - ${reason}`);
      
      if (shouldUpdate) {
        const teamData = extractTeamsFromTitle(post.title);
        
        if (teamData) {
          console.log(`Searching for match: ${teamData.homeTeam} vs ${teamData.awayTeam}`);
          
          const matchData = await searchMatchOnKooraLiveTV(teamData.homeTeam, teamData.awayTeam);
          
          if (matchData.found) {
            console.log('Match data found, generating report...');
            
            const report = generateMatchReport(matchData, post.title);
            const success = await updatePost(post.id, report.title, report.content);
            
            if (success) {
              updatedCount++;
              console.log('✅ Post updated successfully with match report');
            } else {
              errorCount++;
            }
          } else {
            console.log('Match data not found, creating basic report...');
            
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
            
            const report = generateMatchReport(basicMatchData, post.title);
            const success = await updatePost(post.id, report.title, report.content);
            
            if (success) {
              updatedCount++;
              console.log('✅ Post updated with basic report');
            } else {
              errorCount++;
            }
          }
        } else {
          console.log('❌ Could not extract team names from title');
          errorCount++;
        }
        
        console.log('Waiting 10 seconds to respect rate limits...');
        await new Promise(resolve => setTimeout(resolve, 10000));
      } else {
        skippedCount++;
      }
    }
    
    console.log(`\nUpdate Complete!`);
    console.log(`   Updated: ${updatedCount} posts`);
    console.log(`   Skipped: ${skippedCount} posts`);
    console.log(`   Errors: ${errorCount} posts`);
    console.log(`   Total processed: ${updatedCount + skippedCount + errorCount}`);
    
  } catch (error) {
    console.error('Error in updateMatchPosts:', error);
    process.exit(1);
  }
}

updateMatchPosts();

// const axios = require('axios');
// const fs = require('fs').promises;

// const BLOG_ID = process.env.BLOG_ID;
// const API_KEY = process.env.API_KEY;
// const ACCESS_TOKEN = process.env.ACCESS_TOKEN;

// async function makeAuthenticatedRequest(url, data, method = 'GET') {
//   const config = {
//     method,
//     url,
//     headers: {
//       Authorization: `Bearer ${ACCESS_TOKEN}`,
//       'Content-Type': 'application/json'
//     }
//   };
  
//   if (data && method !== 'GET') {
//     config.data = data;
//   }
  
//   return await axios(config);
// }

// function isMatchFinished(timeString, publishedDate) {
//   if (!timeString || timeString === 'TBD' || timeString === 'انتهت') {
//     return true;
//   }
  
//   try {
//     const publishedTime = new Date(publishedDate);
//     const now = new Date();
    
//     const timeParts = timeString.match(/(\d{1,2}):(\d{2})/);
//     if (!timeParts) return true;
    
//     let matchHour = parseInt(timeParts[1]);
//     let matchMinute = parseInt(timeParts[2]);
    
//     if (timeString.toLowerCase().includes('pm') && matchHour !== 12) {
//       matchHour += 12;
//     } else if (timeString.toLowerCase().includes('am') && matchHour === 12) {
//       matchHour = 0;
//     }
    
//     const matchDate = new Date(publishedTime);
//     matchDate.setHours(matchHour, matchMinute, 0, 0);
    
//     const matchEndTime = new Date(matchDate.getTime() + (3 * 60 * 60 * 1000));
    
//     return now > matchEndTime;
//   } catch (error) {
//     console.error('Error parsing match time:', error);
//     return true;
//   }
// }

// async function loadUrlMappings() {
//   const path = './match-urls.json';
  
//   try {
//     const data = await fs.readFile(path, 'utf8');
//     const mappings = JSON.parse(data);
//     console.log(`Loaded ${Object.keys(mappings).length} URL mappings`);
//     return mappings;
//   } catch (error) {
//     console.log('No URL mappings file found');
//     return {};
//   }
// }

// async function saveUrlMappings(mappings) {
//   const path = './match-urls.json';
  
//   try {
//     await fs.writeFile(path, JSON.stringify(mappings, null, 2));
//     console.log(`Updated URL mappings saved (${Object.keys(mappings).length} entries)`);
//   } catch (error) {
//     console.error('Error saving URL mappings:', error);
//   }
// }

// async function extractPostIdFromUrl(postUrl) {
//   try {
//     if (postUrl.includes('/posts/')) {
//       const matches = postUrl.match(/\/posts\/(\d+)/);
//       if (matches && matches[1]) {
//         return matches[1];
//       }
//     }
    
//     const urlParts = postUrl.split('/');
//     const fileName = urlParts[urlParts.length - 1];
//     const postTitle = fileName.replace('.html', '').replace(/-/g, ' ');
    
//     const searchUrl = `https://www.googleapis.com/blogger/v3/blogs/${BLOG_ID}/posts/search?q=${encodeURIComponent(postTitle)}&key=${API_KEY}`;
//     const response = await axios.get(searchUrl);
    
//     if (response.data.items && response.data.items.length > 0) {
//       const exactMatch = response.data.items.find(post => post.url === postUrl);
//       if (exactMatch) {
//         return exactMatch.id;
//       }
//       return response.data.items[0].id;
//     }
    
//     console.log(`No post found for URL: ${postUrl}`);
//     return null;
//   } catch (error) {
//     console.error(`Error extracting post ID from URL ${postUrl}:`, error);
//     return null;
//   }
// }

// async function deletePost(postId) {
//   try {
//     const url = `https://www.googleapis.com/blogger/v3/blogs/${BLOG_ID}/posts/${postId}`;
//     await makeAuthenticatedRequest(url, null, 'DELETE');
//     console.log(`Successfully deleted post ${postId}`);
//     return true;
//   } catch (error) {
//     if (error.response?.status === 404) {
//       console.log(`Post ${postId} not found (already deleted)`);
//       return true;
//     }
//     console.error(`Error deleting post ${postId}:`, error.response?.data || error.message);
//     return false;
//   }
// }

// async function getAllBlogPosts(maxResults = 500) {
//   try {
//     console.log(`Fetching all blog posts (max: ${maxResults})`);
    
//     let allPosts = [];
//     let pageToken = '';
//     let pageCount = 0;
    
//     do {
//       pageCount++;
//       let url = `https://www.googleapis.com/blogger/v3/blogs/${BLOG_ID}/posts?maxResults=50&key=${API_KEY}`;
      
//       if (pageToken) {
//         url += `&pageToken=${pageToken}`;
//       }
      
//       console.log(`Fetching page ${pageCount}...`);
//       const response = await axios.get(url);
      
//       if (response.data.items) {
//         allPosts = allPosts.concat(response.data.items);
//         console.log(`Added ${response.data.items.length} posts (total: ${allPosts.length})`);
//       }
      
//       pageToken = response.data.nextPageToken;
      
//       if (allPosts.length >= maxResults) {
//         allPosts = allPosts.slice(0, maxResults);
//         break;
//       }
      
//       if (pageToken) {
//         console.log('Waiting 2 seconds before next page...');
//         await new Promise(resolve => setTimeout(resolve, 2000));
//       }
      
//     } while (pageToken && allPosts.length < maxResults);
    
//     console.log(`Total posts fetched: ${allPosts.length}`);
//     return allPosts;
//   } catch (error) {
//     console.error('Error fetching blog posts:', error.response?.data || error.message);
//     return [];
//   }
// }

// function isMatchPost(postTitle) {
//   const matchPatterns = [
//     /vs\s/i,
//     /\s-\s.*(?:league|cup|championship|liga|premier|serie|bundesliga|ligue)/i,
//     /مباراة/,
//     /ضد/
//   ];
  
//   return matchPatterns.some(pattern => pattern.test(postTitle));
// }

// async function deleteOldMatchPosts() {
//   try {
//     console.log('Starting to delete old match posts...');
    
//     if (!BLOG_ID || !API_KEY || !ACCESS_TOKEN) {
//       console.error('Missing required environment variables');
//       console.error('Required: BLOG_ID, API_KEY, ACCESS_TOKEN');
//       process.exit(1);
//     }
    
//     console.log('All required environment variables found');
//     console.log(`Blog ID: ${BLOG_ID}`);
    
//     let urlMappings = await loadUrlMappings();
//     let allPosts = await getAllBlogPosts();
    
//     if (allPosts.length === 0) {
//       console.log('No posts found to process');
//       return;
//     }
    
//     const matchPosts = allPosts.filter(post => isMatchPost(post.title));
//     console.log(`Found ${matchPosts.length} match posts out of ${allPosts.length} total posts`);
    
//     let deletedCount = 0;
//     let skippedCount = 0;
//     let errorCount = 0;
//     const deletedMappings = [];
//     const updatedMappings = { ...urlMappings };
    
//     for (const post of matchPosts) {
//       console.log(`\nProcessing: ${post.title}`);
//       console.log(`Published: ${new Date(post.published).toLocaleString()}`);
      
//       const postAge = (new Date() - new Date(post.published)) / (1000 * 60 * 60);
//       console.log(`Post age: ${postAge.toFixed(1)} hours`);
      
//       let shouldDelete = false;
//       let reason = '';
      
//       if (postAge > 24) {
//         shouldDelete = true;
//         reason = `Post is ${postAge.toFixed(1)} hours old (>24h)`;
//       } else {
//         const timeMatch = post.content?.match(/⏰\s*(\d{1,2}:\d{2}(?:\s*[AP]M)?)/i);
//         const matchTime = timeMatch ? timeMatch[1] : null;
        
//         if (matchTime) {
//           const isFinished = isMatchFinished(matchTime, post.published);
//           if (isFinished) {
//             shouldDelete = true;
//             reason = `Match at ${matchTime} is finished`;
//           } else {
//             reason = `Match at ${matchTime} is still current/future`;
//           }
//         } else {
//           if (postAge > 6) {
//             shouldDelete = true;
//             reason = `No match time found and post is ${postAge.toFixed(1)} hours old (>6h)`;
//           } else {
//             reason = `No match time found but post is only ${postAge.toFixed(1)} hours old (<6h)`;
//           }
//         }
//       }
      
//       console.log(`Decision: ${shouldDelete ? 'DELETE' : 'KEEP'} - ${reason}`);
      
//       if (shouldDelete) {
//         const success = await deletePost(post.id);
        
//         if (success) {
//           deletedCount++;
          
//           const mappingKey = Object.keys(updatedMappings).find(key => 
//             updatedMappings[key].url === post.url
//           );
          
//           if (mappingKey) {
//             deletedMappings.push(mappingKey);
//             console.log(`Removing mapping: ${updatedMappings[mappingKey].readableKey}`);
//             delete updatedMappings[mappingKey];
//           }
//         } else {
//           errorCount++;
//         }
        
//         console.log('Waiting 10 seconds to respect rate limits...');
//         await new Promise(resolve => setTimeout(resolve, 10000));
//       } else {
//         skippedCount++;
//       }
//     }
    
//     if (deletedMappings.length > 0) {
//       console.log(`Saving updated mappings (removed ${deletedMappings.length} entries)`);
//       await saveUrlMappings(updatedMappings);
//     }
    
//     console.log(`\nDeletion Complete!`);
//     console.log(`   Deleted: ${deletedCount} posts`);
//     console.log(`   Skipped: ${skippedCount} posts`);
//     console.log(`   Errors: ${errorCount} posts`);
//     console.log(`   Total processed: ${deletedCount + skippedCount + errorCount}`);
//     console.log(`   Cleaned mappings: ${deletedMappings.length} entries`);
    
//   } catch (error) {
//     console.error('Error in deleteOldMatchPosts:', error);
//     process.exit(1);
//   }
// }

// deleteOldMatchPosts();
