local LrApplication = import 'LrApplication'
local LrDate = import 'LrDate'
local LrDialogs = import 'LrDialogs'
local LrExportSession = import 'LrExportSession'
local LrFileUtils = import 'LrFileUtils'
local LrFunctionContext = import 'LrFunctionContext'

local ymdPattern = "^(%d+)%-(%d+)%-(%d+)T"

local prefix = "/Users/scouten/Projects/ericscouten.travel/content"

local function sitePath(y, m, d, title)
	title = title:lower():gsub("\’", ""):gsub("%W+", "-"):gsub("the%-", ""):gsub("-$", "")
	return prefix .. "/" .. y .. "/" .. m .. "-" .. d .. "-" .. title
end

local function canShowLocation(photo)
	if photo:getRawMetadata('isVirtualCopy') then
		return false
	end

	if photo:getRawMetadata('gps') then
		local location = photo:getFormattedMetadata('location')
		if location and not (location:match("^Home") or location:match("Residence")) then
			return true	
		end
	end
	return false
end

local function captionAndLocation(photo)
	local caption = photo:getFormattedMetadata('caption')

	if caption:match(", %d%d%d%d\n?$") then
		if caption:match("\n") then
			local _, _, location = caption:find("([^\n]+)$")
			caption = caption:sub(1, #caption - #location)
			caption = caption:gsub("\n+$", "")
			return caption, location
		else
			return "", caption
		end
	else
		return caption, ""
	end
end

local function roundLatLon(value)
	return math.floor((value * 1000) + .5) / 1000
end

LrFunctionContext.postAsyncTaskWithContext("Create ericscouten.travel Blog Post",
function(context)

	local catalog = LrApplication.activeCatalog()

	-- Identify cover photo to be exported. We'll use that photo's date
	-- as this post's mod date and default path.

	local coverPhoto

	for _, photo in ipairs(catalog.targetPhotos) do
		if photo:getRawMetadata('isVirtualCopy') then
			coverPhoto = photo
			break
		end
	end

	-- Identify photo to use for metadata base.

	local filmstrip = catalog.targetPhotos
	local firstPhoto = coverPhoto or filmstrip[1]

	if not firstPhoto then
		LrDialogs.message("No photos selected!")
		return
	end

	-- Segregate out photos and videos.

	local regularPhotos = {}
	local videos = {}
	local photosAndVideos = {}
	local showMarkers = false
	local n, s, e, w

	for _, photo in ipairs(filmstrip) do
		if not photo:getRawMetadata('isVirtualCopy') then
			if photo:getRawMetadata('isVideo') then
				table.insert(videos, photo)
			else
				table.insert(regularPhotos, photo)
			end
			table.insert(photosAndVideos, photo)

			if canShowLocation(photo) then
				showMarkers = true

				for _, photo in ipairs(catalog.targetPhotos) do
					if not photo:getRawMetadata('isVirtualCopy') then
						local gps = photo:getRawMetadata("gps")
						if gps then
							local lat = gps.latitude
							local lon = gps.longitude
		
							n = n and math.max(n, lat) or lat
							s = s and math.min(s, lat) or lat
							e = e and math.max(e, lon) or lon
							w = w and math.min(w, lon) or lon
						end
					end
				end
			end
		end
	end

	-- Choose the date & time for the post.

	local dateTime = firstPhoto:getRawMetadata('dateTimeOriginalISO8601')

	-- Choose the output path for this post.

	local y, m, d = dateTime:match(ymdPattern)
	local title = firstPhoto:getFormattedMetadata('title')

	local postPath = sitePath(y, m, d, title)
	LrFileUtils.createAllDirectories(postPath)

	-- Create starter Markdown page.

	local escapedTitle = title or "(untitled fine story)"
	escapedTitle = escapedTitle:gsub("\\", "\\\\")
	escapedTitle = escapedTitle:gsub("\"", "\\\"")

	local state = firstPhoto:getFormattedMetadata('stateProvince')

	local caption, location = captionAndLocation(firstPhoto)

	local checkTz = ""
	if state ~= "Washington" then
		checkTz = " # check time zone (not in Washington)"
	end

	caption = caption:gsub("’", "'"):gsub("[“”]", "\""):gsub("\n+$", "")

	local updated = LrDate.timeToUserFormat(LrDate.currentTime(),
		"%Y-%m-%dT%H:%M:%S-07:00")
		-- change TZ when we go to winter time (ugh)

	local index = assert(io.open(postPath .. "/index.md", "w"))
	index:write("+++\n")
	index:write("title = \"" .. escapedTitle .. "\"\n")
	index:write("date = " .. dateTime .. checkTz .. "\n")
	index:write("updated = " .. updated .. "\n")
	index:write("\n")
	index:write("[extra]\n")
	index:write("first_published_on = \"where???\"\n")

	index:write("distance = \"3 km / 2 mi\"\n")
	index:write("route = \"city, state, to city, state\"\n")

	if showMarkers then
		index:write("markers = \"markers.js\"\n")

		if n and s and e and w then
			if n - s < .02 then
				local midLat = (n + s) / 2
				n = midLat + .01
				s = midLat - .01
			end

			if e - w < .02 then
				local midLon = (e + w) / 2
				e = midLon + .01
				w = midLon - .01
			end

			index:write("bounds = {sw = [" ..
				roundLatLon(s) ..", " ..
				roundLatLon(w) .. "], ne = [" ..
				roundLatLon(n) .. ", " ..
				roundLatLon(e) .. "]}\n")
		end
	end

	for _, photo in ipairs(catalog.targetPhotos) do
		if photo:getRawMetadata('isVirtualCopy') then
			local pid = photo.path
			pid = pid:gsub("^.*/", "")
			pid = pid:gsub("%..*$", "")
			index:write("cover = \"" .. pid .. "\"\n")
			break
		end
	end

	index:write("+++\n")
	index:write("\n")

	if caption ~= "" then
		index:write(caption .. "\n")
		index:write("\n")
	end

	index:write("<!-- more -->\n")
	index:write("\n")

	if showMarkers and location then
		local trimmedLoc, _ = location:gsub(", %d%d%d%d$", "")
		index:write(trimmedLoc .. "\n\n")
	end

	for _, photo in ipairs(catalog.targetPhotos) do
		if not photo:getRawMetadata('isVirtualCopy') then
			local title = photo:getFormattedMetadata('title')
			if title then
				title = ", title = \"" .. title .. "\""
			else
				title = ""
			end

			local caption = photo:getFormattedMetadata('caption')
			if caption then
				caption = ", caption = \"" .. caption:gsub(", %d%d%d%d$", "") .. "\""
			else
				caption = ""
			end

			if photo:getRawMetadata('isVideo') then
				local pid = photo.path
				pid = pid:gsub("^.*/", "")
				pid = pid:gsub("%..*$", "")
				index:write("{{ es_vimeo(id=\"" .. pid .. "\" vmid=\"zzzzzzz\"" .. title .. caption .. ") }}\n")
			else
				local pid = photo.path
				pid = pid:gsub("^.*/", "")
				pid = pid:gsub("%..*$", "")
				index:write("{{ es_image(id=\"" .. pid .. "\"" .. title .. caption .. ") }}\n")
			end
		end

		if photo:getRawMetadata('gps') then
			local location = photo:getFormattedMetadata('location')
			if location and not (location:match("^Home") or location:match("Residence")) then

			end
		end

	end
	
	index:close()

	-- Create markers.js file to place photos on page.

	if showMarkers then
		local markers = assert(io.open(postPath .. "/markers.js", "w"))

		markers:write("function addGpxMarkers(map) {\n")
		markers:write("    return [\n")

		for _, photo in ipairs(catalog.targetPhotos) do
			if not photo:getRawMetadata('isVirtualCopy') then

				local pid = photo.path
				pid = pid:gsub("^.*/", "")
				pid = pid:gsub("%..*$", "")

				local gps = photo:getRawMetadata("gps") or {}
				local lat = gps.latitude
				local lon = gps.longitude

				if lat and lon then
					lat = string.format("%.6f", lat)
					lon = string.format("%.6f", lon)
					markers:write('        addGpxMarker(map, "' .. pid .. '", ' .. lat .. ', ' .. lon .. '),\n')
				end
			end
		end

		markers:write("    ]\n")
		markers:write("}\n")
		markers:close()
	end

	-- Generate the photo and video renditions.

	if coverPhoto then
		local exportSession = import 'LrExportSession' {
			exportSettings = {
				collisionHandling = 'overwrite',
				embeddedMetadataOption = 'allExceptCameraRawInfo',
				exportServiceProvider = 'com.adobe.ag.export.file',
				exportServiceProviderTitle = "Hard Drive",
				export_colorSpace = 'sRGB',
				export_destinationPathPrefix = postPath,
				export_destinationPathSuffix = '',
				export_destinationType = 'specificFolder',
				-- export_postProcessing = "revealInFinder",
				export_useParentFolder = false,
				export_useSubfolder = false,
				export_videoFileHandling = 'include',
				extensionCase = 'lowercase',
				format = 'JPEG',
				includeFaceTagsAsKeywords = true,
				includeFaceTagsInIptc = true,
				includeVideoFiles = false,
				jpeg_limitSize = 100,
				jpeg_quality = 0.8,
				jpeg_useLimitSize = false,
				metadata_keywordOptions = 'flat',
				outputSharpeningLevel = 2,
				outputSharpeningMedia = 'screen',
				outputSharpeningOn = true,
				reimportExportedPhoto = false,
				removeFaceMetadata = true,
				removeLocationMetadata = true,
				renamingTokensOn = true,
				size_doConstrain = true,
				size_doNotEnlarge = true,
				size_maxHeight = 1000,
				size_maxWidth = 500,
				size_percentage = 100,
				size_resizeType = 'longEdge',
				size_resolution = 72,
				size_resolutionUnits = 'inch',
				size_units = 'pixels',
				size_userWantsConstrain = true,
				tokenCustomString = "cover",
				tokens = "{{custom_token}}-{{image_name}}",
				tokensArchivedToString2 = "{{image_name}}",
				useWatermark = false,
			},
			photosToExport = {coverPhoto}
		}

		exportSession:doExportOnCurrentTask()
	end

	if #regularPhotos > 0 then
		local exportSession = import 'LrExportSession' {
			exportSettings = {
				collisionHandling = 'overwrite',
				embeddedMetadataOption = 'allExceptCameraRawInfo',
				exportServiceProvider = 'com.adobe.ag.export.file',
				exportServiceProviderTitle = "Hard Drive",
				export_colorSpace = 'sRGB',
				export_destinationPathPrefix = postPath,
				export_destinationPathSuffix = '',
				export_destinationType = 'specificFolder',
				export_useParentFolder = false,
				export_useSubfolder = false,
				extensionCase = 'lowercase',
				format = 'JPEG',
				includeFaceTagsAsKeywords = true,
				includeFaceTagsInIptc = true,
				includeVideoFiles = false,
				initialSequenceNumber = 1,
				jpeg_limitSize = 100,
				jpeg_quality = 0.8,
				jpeg_useLimitSize = false,
				metadata_keywordOptions = 'flat',
				outputSharpeningLevel = 2,
				outputSharpeningMedia = 'screen',
				outputSharpeningOn = true,
				reimportExportedPhoto = false,
				removeFaceMetadata = true,
				removeLocationMetadata = true,
				renamingTokensOn = true,
				size_doConstrain = true,
				size_doNotEnlarge = true,
				size_maxHeight = 1500,
				size_maxWidth = 500,
				size_percentage = 100,
				size_resizeType = 'longEdge',
				size_resolution = 72,
				size_resolutionUnits = 'inch',
				size_units = 'pixels',
				size_userWantsConstrain = true,
				tokens = "{{image_name}}",
				tokensArchivedToString2 = "{{image_name}}",
				useWatermark = false,
			},
			photosToExport = regularPhotos
		}

		exportSession:doExportOnCurrentTask()
	end

	if #videos > 0 then
		local exportSession = LrExportSession {
			exportSettings = {
				collisionHandling = 'overwrite',
				embeddedMetadataOption = 'allExceptCameraRawInfo',
				exportServiceProvider = 'com.adobe.ag.export.file',
				exportServiceProviderTitle = "Hard Drive",
				export_colorSpace = 'sRGB',
				export_destinationPathPrefix = "/Users/scouten/Desktop",
				export_destinationPathSuffix = "Upload to Vimeo",
				export_destinationType = 'specificFolder',
				export_postProcessing = 'revealInFinder',
				export_useParentFolder = false,
				export_useSubfolder = true,
				export_videoFormat = "4e49434b-4832-3634-fbfb-fbfbfbfbfbfb",
				export_videoPreset = "SIZE_medium",
				extensionCase = 'lowercase',
				format = 'JPEG',
				includeFaceTagsAsKeywords = true,
				includeFaceTagsInIptc = true,
				includeVideoFiles = true,
				initialSequenceNumber = 1,
				jpeg_limitSize = 100,
				jpeg_quality = 0.8,
				jpeg_useLimitSize = false,
				metadata_keywordOptions = 'flat',
				outputSharpeningLevel = 2,
				outputSharpeningMedia = 'screen',
				outputSharpeningOn = true,
				reimportExportedPhoto = false,
				removeFaceMetadata = true,
				removeLocationMetadata = true,
				renamingTokensOn = true,
				size_doConstrain = true,
				size_doNotEnlarge = true,
				size_maxHeight = 1500,
				size_maxWidth = 500,
				size_percentage = 100,
				size_resizeType = 'longEdge',
				size_resolution = 72,
				size_resolutionUnits = 'inch',
				size_units = 'pixels',
				size_userWantsConstrain = true,
				tokens = "{{image_name}}",
				tokensArchivedToString2 = "{{image_name}}",
				useWatermark = false,
			},
			photosToExport = videos
		}

		exportSession:doExportOnCurrentTask()
	end
end)
