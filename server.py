"""Read-only ESPN fantasy proxy and NFL weekly schedule lookup."""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs, urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
import json, os

LEAGUE_ID = '84639375'

class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path not in ('/api/espn', '/api/nfl-week'):
            return super().do_GET()
        try:
            q = parse_qs(parsed.query)
            year = int(q.get('year', ['2026'])[0])
            week = int(q.get('week', ['1'])[0])
            if not (2018 <= year <= 2100 and 1 <= week <= 18):
                raise ValueError('Invalid season or week')
            if parsed.path == '/api/espn':
                endpoint = f'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/{year}/segments/0/leagues/{LEAGUE_ID}'
                params = [('view', 'mTeam'), ('view', 'mBoxscore'), ('view', 'mRoster'), ('view', 'kona_player_info'), ('scoringPeriodId', str(week)), ('matchupPeriodId', str(week))]
            else:
                endpoint = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard'
                params = [('dates', str(year)), ('seasontype', '2'), ('week', str(week)), ('limit', '100')]
            req = Request(endpoint + '?' + urlencode(params), headers={'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json'})
            with urlopen(req, timeout=20) as response:
                payload = response.read(12_000_000)
            obj = json.loads(payload)
            if parsed.path == '/api/espn' and not isinstance(obj.get('teams'), list):
                raise ValueError('ESPN did not provide league teams')
            if parsed.path == '/api/nfl-week':
                events = obj.get('events')
                if not isinstance(events, list) or len(events) < 10:
                    raise ValueError('NFL schedule was incomplete; bye detection disabled')
                teams = set()
                for event in events:
                    for competition in event.get('competitions', []):
                        for competitor in competition.get('competitors', []):
                            ident = competitor.get('team', {}).get('id')
                            if ident is not None:
                                teams.add(int(ident))
                if len(teams) < 20:
                    raise ValueError('NFL schedule contains too few teams to verify byes')
                obj = {'year': year, 'week': week, 'playingTeamIds': sorted(teams), 'eventCount': len(events)}
            self.respond(200, obj)
        except HTTPError as e:
            self.respond(502, {'error': f'ESPN returned HTTP {e.code}'})
        except (URLError, ValueError, TimeoutError, json.JSONDecodeError) as e:
            self.respond(502, {'error': f'Could not retrieve ESPN data: {e}'})
        except Exception as e:
            self.respond(500, {'error': f'Unexpected integration error: {e}'})

    def respond(self, status, obj):
        body = json.dumps(obj).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

if __name__ == '__main__':
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    port = int(os.environ.get('PORT', '8765'))
    print(f'Serving on port {port}')
    ThreadingHTTPServer(('0.0.0.0', port), Handler).serve_forever()
