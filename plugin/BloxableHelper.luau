--!strict
-- BloxableHelper — Studio companion plugin for Bloxable.
--
-- Everything this plugin does, in one sentence: it tells the Bloxable app
-- running on THIS machine which Roblox account is signed into Studio.
-- Nothing else.
--
-- What it sends
--   One POST to http://localhost:3000 (the local Bloxable dev app) with the
--   JSON body { "userId": <number> }. StudioService:GetUserId() returns the
--   signed-in user's id, or 0 when nobody is signed in — both are reported
--   exactly as Studio gives them, so the app can tell "signed out" apart
--   from "never heard from the plugin".
--
-- What it never touches
--   Cookies, .ROBLOSECURITY, auth tokens, files, or any roblox.com endpoint.
--   The only network destination is localhost. The first request will make
--   Studio ask you to allow this plugin to reach that domain — that prompt
--   is Studio's own plugin-permission system working as intended, and
--   denying it simply leaves Bloxable not knowing who is signed in.
--
-- Install (a dedicated consent/install flow ships separately): save this
-- file into your local plugins folder (Studio → Plugins → Plugins Folder),
-- then restart Studio.

local StudioService = game:GetService("StudioService")
local HttpService = game:GetService("HttpService")

-- The Bloxable dev server (package.json `npm run dev` → next dev, port 3000).
local APP_ORIGIN = "http://localhost:3000"
local ENDPOINT = APP_ORIGIN .. "/api/roblox/eligibility/studio-user"

-- The app might not be running yet when Studio loads the plugin, so a report
-- gets a few quiet attempts and then gives up until next plugin load. No
-- polling loop, no background chatter.
local MAX_ATTEMPTS = 3
local RETRY_SECONDS = 10

-- Sends one report. Returns true when the app answered 2xx. Both the encode
-- and the request sit in pcall: with Bloxable closed the request throws
-- (connection refused), and that must never surface as a Studio error popup.
local function report(): boolean
	-- 0 = signed out. Reported as-is, never invented or substituted.
	local userId = StudioService:GetUserId()

	local okRequest, response = pcall(function()
		return HttpService:RequestAsync({
			Url = ENDPOINT,
			Method = "POST",
			Headers = { ["Content-Type"] = "application/json" },
			Body = HttpService:JSONEncode({ userId = userId }),
		})
	end)

	return okRequest and response.Success == true
end

-- One reporting pass per plugin load, off the main thread so Studio startup
-- is never blocked waiting on a local HTTP call.
task.spawn(function()
	for attempt = 1, MAX_ATTEMPTS do
		if report() then
			return
		end
		if attempt < MAX_ATTEMPTS then
			task.wait(RETRY_SECONDS)
		end
	end
end)
