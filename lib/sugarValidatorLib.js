function validate(fileData, localStorage = {}) {
    const validationErrors = {};
    const validationWarnings = {};
    const validationInfos = {};

    const entityMap = [
        ['&lt;', '<'],
        ['&gt;', '>'],
        ['&quot;', '"'],
        ['&#39;', `'`],
        ['&amp;', '&'],
        ['\t', '  '],
    ];
    function decodeHTML(encodedStr) {
        for (const entity of entityMap) {
            encodedStr = encodedStr.replaceAll(entity[0],entity[1]);
        }
        return encodedStr;
    }

    function recodeHTML(str) {
        for (var index = entityMap.length - 1; index >= 0; index--) {
            const entity = entityMap[index];
            str = str.replaceAll(entity[1], entity[0]);
        }
        return str;
    }

    function textLines(text) {
        return (text.match(/\n/g) || []).length;
    }
    const exclusionMarkup = [
        ['&lt;&lt;script&gt;&gt;', '&lt;&lt;/script&gt;&gt;', '<<script>>', '<</script>>'], // script
        ['"""', '"""', '"""', '"""'], // Markup escape
        ['&lt;nowiki&gt;', '&lt;/nowiki&gt;', '<nowiki>', '</nowiki>'],
        ['{{{', '}}}', '{{{', '}}}'],
        ['/*', '*/', '/*', '*/'],
        ['/%', '%/', '/%', '%/'],
        ['<!--', '-->', '<!--', '-->'],
    ];
    function parsePassage(html, startIndex, contentIndex, endIndex) {
        const line = textLines(html.substring(0,startIndex));
        const header = html.substring(startIndex, contentIndex);
        var content = html.substring(contentIndex, endIndex);
        const exclusions = [];
        var deccontent = '';
        while (true) {
            let start = Infinity;
            let type = -1;
            for (var i = 0; i < exclusionMarkup.length; i++) {
                const markup = exclusionMarkup[i];
                const idx = content.indexOf(markup[0], 0);
                if (idx !== -1 && idx < start) {
                    start = idx;
                    type = i;
                }
            }
            // If none of the opening markup can be found, we're done
            if (type < 0) {
                break;
            }
            // If something is found, find the matching closing markup
            let markup = exclusionMarkup[type];
            let end = content.indexOf(markup[1], start + markup[0].length);
            // try the obsolete version of the closing tag in case of a script-macro
            if (end === -1 && type == 0) {
                const altEnd = '&lt;&lt;endscript&gt;&gt;';
                end = content.indexOf(altEnd, start + markup[0].length);
                if (end !== -1) {
                    markup = markup.slice(0);
                    markup[1] = altEnd;
                    type = -1;
                }
            }
            // If no closing markup is found, add a warning and stop trying to exclude further markup
            if (end === -1) {
                addWarning([[htmlErrorAt(`Opening '${markup[0]}' without closing '${markup[1]}' at `, content, start)]], header);
                break;
            }
            // cut the excluded markup from the html-content
            const text = content.substring(start + markup[0].length, end);
            // decode the content prior to the excluded markup
            deccontent += decodeHTML(content.substr(0, start));
            content = content.substring(end + markup[1].length);
            exclusions.push({ type, start: deccontent.length, text });
        }
        // decode the remaining content
        content = deccontent + decodeHTML(content);
        return { header, content, exclusions, line };
    }

    function getHTMLAttr(html, name) {
        const matches = html.match(/[^\s"]*[\s]*=[\s]*"[^"]*"/g);
        if (matches) {
            for (const match of matches) {
                if (match.startsWith(name)) {
                    const value = match.substring(name.length).replace(/[\s]*=[\s]*("[^"]*")/, '$1');
                    if (value[0] == '"') {
                        return value.substring(1, value.length-1);
                    }
                }
            }
        }
        return null;
    }

    const passageStartTag = '<tw-passagedata';
    const passageCloseTag = '</tw-passagedata>';
    const passages = [];
    const storyStart = fileData.indexOf('<tw-storydata', 0);
    const storyEnd = fileData.indexOf('</tw-storydata>', storyStart);
    if (storyStart === -1) {
        addHtmlError('Could not locate storydata', 'story');
    } else if (storyEnd === -1) {
        addHtmlError(htmlErrorAt('Unclosed storydata at ', fileData, storyStart), 'story');
    }
    let lastIndex = 0;
    while (true) {
        const startIndex = fileData.indexOf(passageStartTag, lastIndex);
        if (startIndex === -1) break;
        const endIndex = fileData.indexOf(passageCloseTag, startIndex);
        const contentIndex = fileData.indexOf('>', startIndex) + 1;
        if (endIndex === -1 || contentIndex === -1) {
            addHtmlError(htmlErrorAt('Unclosed passage found at ', fileData, startIndex), 'passages');
            break;
        }
        if (startIndex < storyStart || endIndex > storyEnd) {
            addHtmlError(htmlErrorAt('Passage not within the storydata at ', fileData, startIndex), 'passages');
        }
        const passage = parsePassage(fileData, startIndex, contentIndex, endIndex);
        // Add stuff
        passages.push(passage);
        lastIndex = endIndex + 16; //passageCloseTag.length;
    }
    function htmlErrorAt(prefix, html, pos) {
        const lines = 1 + textLines(html.substring(0, pos));
        let text = html.substring(pos, pos + 80);
        text = text.replace(/\n/g, '\\n').replace(/\t/g, '\\t');
        return  `Line (${lines}): ` + prefix + text;
    }
    function errorMsgAt(prefix, html, pos) {
        let lines = 1 + textLines(html.content.substring(0, pos));
        let text = html.content.substring(pos, pos + 80);
        if (html.exclusions) {
            for (var idx = html.exclusions.length - 1; idx >= 0; idx--) {
                const excl = html.exclusions[idx];
                const start = excl.start - pos;
                if (start >= 80) continue;
                if (start <= 0) {
                    lines += textLines(excl.text);
                    continue;
                }
                const markup = exclusionMarkup[Math.max(excl.type,0)];
                text = text.substring(0, start) + markup[2] + excl.text + markup[3] + text.substring(start);
            }
            text = text.substring(0, 80);
        }
        text = text.replace(/\n/g, '\\n').replace(/\t/g, '\\t');
        const lc = html.line + lines;
        return `Line ${lines} (${lc}): ` + prefix + text;
    }
    function addHtmlError(msg, header) {
        if (!validationErrors[header]) validationErrors[header] = [];
        validationErrors[header].push(msg);
    }
    function addError(msg, passage) {
        addHtmlError(msg, passage.header);
    }
    function throwError(msg, passage) {
        addError(msg, passage);
        throw 'Error';
    }

    function addWarning(msg, header) {
        if (!validationWarnings[header]) validationWarnings[header] = [];
        validationWarnings[header].push(msg);
    }

    function addInfo(msg, key) {
        if (!validationInfos[key]) validationInfos[key] = [];
        validationInfos[key].push(msg);
    }

    function exprAt(html, pos, sp, tw) {
        let qc = 0;
        const qp = /"'`/
        const ss = [];
        pos--;
        while (true) {
            pos++;
            const nc = html.charAt(pos);
            if (nc == '') {
                return -1;
            }
            if (nc == '\\') {
                pos++;
                continue;
            }
            if (qc != 0) {
                if (nc === qc) {
                    qc = 0;
                }
                continue;
            }
            if (tw && nc == '>' && html.charAt(pos+1) == '>') {
                if (ss.length != 0) {
                    return -1;
                }
                break;
            }
            if (nc.match(sp) && ss.length == 0) {
                break;
            }
            if (nc.match(qp)) {
                qc = nc;
            } else if (nc === '[' || nc === '{' || nc === '(') {
                ss.push(nc === '[' ? ']' : (nc === '{' ? '}' : ')'));
            } else if (nc === ']' || nc === '}' || nc === ')') {
                if (ss.length == 0 || ss[ss.length-1] != nc) {
                    return -1;
                }
                ss.pop();
            }
        }
        return pos;
    }

    function tagPNameAt(html, pos) {
        while (html.charAt(pos).match(/\s/)) {
            pos++;
        }
        let qc = html.charAt(pos);
        let start, end;
        if (qc === '"' || qc === '\'') {
            pos++;
            start = pos;
            while (true) {
                const nc = html.charAt(pos);
                if (nc === qc) {
                    break;
                }
                if (nc == '') {
                    return 0;
                }
                pos++;
            }
            end = pos+1;
        } else if (qc === '[') {
            return markupLinkAt(html, pos);
        } else {
            start = pos;
            while (true) {
                const nc = html.charAt(pos);
                if (nc.match(/[\s>]/)) {
                    break;
                }
                if (nc == '') {
                    return 0;
                }
                pos++;
            }
            end = pos;
        }
        if (start == pos) {
            return 0;
        }
        return [start, end, html.substring(start, pos)];
    }

    function markupLinkAt(html, pos) {
        let cur = pos;
        if (html.charAt(cur) != '[') {
            return 0;
        }
        cur++;
        let end = exprAt(html, cur, /\]/, 0);
        if (end < 0 || html.charAt(end - 1) != ']') {
            return 0;
        }
        end++;
        let name = '';
        if (html.substring(cur,cur+3).toLowerCase() == 'img') {
            cur += 3;
            if (html.charAt(cur) != '[') {
                return 0;
            }
            cur++;
            cur = exprAt(html, cur, /\]/, 0);
            cur++;
            if (html.charAt(cur) == '[') {
                cur++;
                const ne = exprAt(html, cur, /\]/, 0);
                name = html.substring(cur, ne);
            }
        } else if (html.charAt(cur) == '[') {
            cur++;
            const ne = exprAt(html, cur, /\]/, 0);
            name = html.substring(cur, ne);
            const le = name.charAt(0) == '|' ? 0 : exprAt(name, 0, /\|/, 0);
            if (le >= 0) {
                name = name.substring(le + 1);
            }
        } else {
            return 0;
        }
        return [pos, end, name];
    }

    function linkPassage(index, name, names, passageInfo, idx, url) {
        if (url) {
            if (name.match(/^https?:\/\//)) {
                return true;
            }
        }
        var tidx;
        const fc = name.charAt(0);
        if (fc == '' || fc == '$' || fc == '_' || fc == '`') {
            tidx = -1;
        } else {
            if (!names.has(name)) {
                return false;
            }
            tidx = names.get(name);
            if (passageInfo[tidx].isWidget) {
                addError(errorMsgAt(`Widget passage referenced at `, passages[idx], index), passages[idx]);
            }
        }
        const links = passageInfo[idx].links;
        if (!links.has(tidx)) {
            links.set(tidx, []);
        }
        links.get(tidx).push(index);
        return true;
    }

    function findIdConflicts() {
        const pids = new Set();
        const names = new Map();
        let startId = null;
        if (storyStart != -1 && storyEnd != -1) {
            const contentIndex = fileData.indexOf('>', storyStart) + 1;
            const header = fileData.substring(storyStart, contentIndex);
            if (!getHTMLAttr(header, 'name')) {
                addHtmlError(htmlErrorAt('Missing name in storydata at ', fileData, storyStart), header);
            }
            if (!getHTMLAttr(header, 'ifid')) {
                addHtmlError(htmlErrorAt('Missing ifid in storydata at ', fileData, storyStart), header);
            }
            startId = getHTMLAttr(header, 'startnode');
        }
        const specPassageNames = ['PassageDone', 'PassageFooter', 'PassageHeader', 'PassageReady', 'StoryAuthor', 'StoryBanner', 'StoryCaption', 'StoryDisplayTitle', 'StoryInit', 'StoryInterface', 'StoryMenu', 'StorySettings', 'StorySubtitle', 'StoryTitle'];
        const specPassages = [];
        const passageInfo = [];
        for (var i = 0; i < passages.length; i++) {
            const header = passages[i].header;
            const id = getHTMLAttr(header, 'pid');
            const name = getHTMLAttr(header, 'name');
            if (id == null) {
                addWarning([['Missing pid attribute.']], header);
            } else {
                if (pids.has(id)) {
                    addWarning([[`Duplicate pid "${id}".`]], header);
                }
                pids.add(id);
                if (id == startId) {
                    specPassages.push(i);
                    addInfo(`Starting passage: ${name} (${id})`, 'Statistics');
                }
            }
            if (name == null) {
                addWarning([['Missing name attribute.']], header);
            } else {
                if (names.has(name)) {
                    addWarning([[`Duplicate name "${name}".`]], header);
                }
                names.set(name, i);
                if (specPassageNames.indexOf(name) != -1) {
                    specPassages.push(i);
                }
            }
            const tags = getHTMLAttr(header, 'tags');
            let isWidget = 0;
            if (tags) {
                const tagList = tags.split(' ');
                if (tagList.indexOf('start') != -1) {
                    specPassages.push(i);
                }
                isWidget = tagList.indexOf('widget') !== -1;
            }
            passageInfo.push({name, id, isWidget, links: new Map()}); 
        }
        addInfo(`Number of passages: ${passages.length}`, 'Statistics');
        for (var i = 1; ; i++) {
            if (pids.has(`${i}`)) continue;
            addInfo(`Next unused pid: ${i}`, 'Statistics');
            break;
        }
        for (var i = 0; i < passages.length; i++) {
            const passage = passages[i];
            const html = passage.content;
            // check includes
            var index = 0;
            while (true) {
                index = indexOfMacro(html, 'include', index);
                if (index == -1) break;
                index += 10;

                const nameAt = tagPNameAt(html, index);
                if (!nameAt) {
                    addError(errorMsgAt(`Could not parse passage to include at `, passage, index - 10), passage);
                    continue;
                }
                const name = nameAt[2];
                if (!linkPassage(index - 10, name, names, passageInfo, i)) {
                    addError(errorMsgAt(`Non-existing passage '${name}' included at `, passage, index - 10), passage);
                }
            }
            // check links
            index = 0;
            while (true) {
                index = indexOfMacro(html, 'link', index);
                if (index == -1) break;
                index += 7;

                let nameAt = tagPNameAt(html, index);
                if (!nameAt) {
                    addError(errorMsgAt(`Could not parse link label at `, passage, index - 7), passage);
                    continue;
                }
                let name = nameAt[2];
                let fc = name.charAt(0);
                if (fc == '[') {
                    nameAt = markupLinkAt(html, nameAt[0]);
                    if (!nameAt) continue;
                    const name = nameAt[2];
                    if (!linkPassage(index - 7, name, names, passageInfo, i)) {
                        addError(errorMsgAt(`Non-existing passage '${name}' linked at `, passage, index - 7), passage);
                    }                    
                    continue;
                }
                // skip the name
                var cursor = nameAt[1];
                // skip whitespaces
                while (true) {
                    const lc = html.charAt(cursor);
                    if (lc == '' || !lc.match(/\s/)) {
                        break;
                    }
                    cursor++;
                }
                if (html.charAt(cursor) == '>') {
                    continue;
                }
                nameAt = tagPNameAt(html, cursor);
                if (!nameAt) continue;
                name = nameAt[2];
                if (!linkPassage(index - 7, name, names, passageInfo, i)) {
                    addError(errorMsgAt(`Non-existing passage '${name}' linked at `, passage, index - 7), passage);
                }
            }
            // check gotos
            index = 0;
            while (true) {
                index = indexOfMacro(html, 'goto', index);
                if (index == -1) break;
                index += 7;

                const nameAt = tagPNameAt(html, index);
                if (!nameAt) {
                    addError(errorMsgAt(`Could not parse passage to direct at `, passage, index - 7), passage);
                    continue;
                }
                const name = nameAt[2];
                if (!linkPassage(index - 7, name, names, passageInfo, i)) {
                    addError(errorMsgAt(`Non-existing passage '${name}' directed at `, passage, index - 7), passage);
                }
            }
            // try link markups
            index = 0;
            while (true) {
                const next = html.indexOf('[', index);
                if (next == -1) break;
                // skip content in code
                let cur = index;
                while (true) {
                    cur = html.indexOf('<<', cur);
                    if (cur == -1 || cur > next) {
                        cur = -1;
                        break;
                    }
                    let end, bs = 0;
                    while (true) {
                        cur += 2;
                        end = html.indexOf('>>', cur);
                        let nb = html.indexOf('<<', cur);
                        if (nb != -1 && nb < end) {
                            bs++;
                            cur = nb;
                            continue;
                        }
                        cur = end;
                        if (cur != -1 && bs != 0) {
                            bs--;
                            continue;
                        }
                        break;
                    }
                    if (cur == -1 || cur > next) {
                        break; // non-closed LTGT should be reported by matchGTLT
                    }
                }
                if (cur > next) {
                    index = cur;
                    continue;
                }
                index = next;
                // parse the link markup
                const nameAt = markupLinkAt(html, index);
                if (!nameAt) {
                    index++;
                    continue;
                }
                const name = nameAt[2];
                if (!linkPassage(index, name, names, passageInfo, i, 1)) {
                    addWarning([[errorMsgAt(`Non-existing passage '${name}' targeted at `, passage, index)]], passage.header);
                }
                index = nameAt[1];
            }
            // !HACK! NON-STANDARD !HACK!
            index = 0;
            while (true) {
                index = indexOfMacro(html, 'popup', index);
                if (index == -1) break;
                index += 8;

                const nameAt = tagPNameAt(html, index);
                if (!nameAt) {
                    addError(errorMsgAt(`Could not parse passage to popup at `, passage, index - 8), passage);
                    continue;
                }
                const name = nameAt[2];
                if (!linkPassage(index - 8, name, names, passageInfo, i)) {
                    addError(errorMsgAt(`Non-existing passage '${name}' popup at `, passage, index - 8), passage);
                }
            }
        }
        {
            const stack = specPassages;
            const ap = new Set();
            while (stack.length != 0) {
                const next = stack[stack.length - 1];
                stack.pop();
                if (!ap.has(next)) {
                    ap.add(next);
                    const pi = passageInfo[next];
                    for (const key of pi.links.keys()) {
                        if (key == -1) continue;
                        stack.push(key);
                    }
                }
            }

            for (var i = 0; i < passageInfo.length; i++) {
                const pi = passageInfo[i];
                if (pi.isWidget) {
                    ap.add(i);
                }
            }

            if (ap.size == 0 || ap.size == passages.length) {

            } else if (ap.size > passages.length / 2) {
                let msg = '';
                let num = 0;
                for (var i = 0; i < passages.length; i++) {
                    if (ap.has(i)) continue;
                    msg += ', ' + passageInfo[i].name;
                    num++;
                }
                msg = msg.substring(2);
                addInfo(`Unreachable passages (${num}): ${msg}`, 'Statistics');
            } else {
                let msg = '';
                let num = 0;
                for (var i = 0; i < passages.length; i++) {
                    if (!ap.has(i)) continue;
                    msg += ', ' + passageInfo[i].name;
                    num++;
                }
                msg = msg.substring(2);
                addInfo(`Reachable passages (${num}): ${msg}`, 'Statistics');
            }
        }
    }

    function matchQuotes(html, passage) {
        const doubleQuotes = html.match(/"/g);
        // const singleQuotes = html.match(/'/g);
        if (doubleQuotes && (doubleQuotes.length % 2)) addWarning([['Uneven number of double-quotes in passage']], passage.header);
        // if (singleQuotes && (singleQuotes.length % 2)) addWarning([['Uneven number of single-quotes in']], passage.header);
        const dualQuotes = html.match(/\'\'/g);
        if (dualQuotes && (dualQuotes.length % 2)) addWarning([['Uneven number of dual-quotes in passage']], passage.header);
        const dualSlashes = html.match(/\/\//g);
        if (dualSlashes && (dualSlashes.length % 2)) addWarning([['Uneven number of dual-slashes in passage']], passage.header);
    }

    function matchGTLT(html, passage) {
        var cursor = 0;
        var stack = [];
        while (true) {
            var nextStart = html.indexOf('<<', cursor);
            var nextEnd = html.indexOf('>>', cursor);

            if (nextStart === -1) nextStart = Infinity;
            if (nextEnd === -1) nextEnd = Infinity;

            if (nextStart < nextEnd) {
                stack.push(nextStart);
                cursor = nextStart + 2;
                continue;
            }
            const idx = stack.length-1;
            if (nextEnd < nextStart) {
                if (idx < 0) {
                    return throwError(errorMsgAt(`Closing '>>' without matching '<<' at `, passage, nextEnd) , passage);
                }
                stack.pop();
                cursor = nextEnd + 2;
                continue;
            }
            if (idx >= 0) {
                return throwError(errorMsgAt(`Opening '<<' without matching '>>' at `, passage, stack[idx]) , passage);
            }
            break; // done
        }
    }

    function hiderTag(stack, tag) {
        var hider = [];
        while (stack.length != 0) {
            const last = stack[stack.length-1];
            if (last.tag != tag) {
                hider.push(last);
                stack.pop();
                continue;
            }
            return hider[0];
        }
        return null;
    }

    function digStackForTag(stack, tag, subtype, pos, passage) {
        if (subtype == 1) {
            // html tag -> fake success
            var fake = 1;
            var index1 = stack.length;
            if (index1 != 0) {
                const last = stack[index1-1];
                if (last.tag != tag || last.tagtype != 1) {
                    addWarning([[errorMsgAt('Unmatched tag at ', passage, pos)]], passage.header);
                } else {
                    fake = 0;
                }
            }
            if (fake) {
                index1++;
                stack.push({});
            }
            return index1;
        }
        // SugarCube macro
        if (subtype == 2) {
            // - requires an opening tag somewhere
            for (var index = stack.length - 1; index >= 0; index--) {
                const entry = stack[index];
                if (entry.tag == tag && entry.tagtype == 0) {
                    return index + 1;
                }
            }
        } else {
            // - requires a direct opening tag
            while (stack.length != 0) {
                const idx = stack.length-1;
                const last = stack[idx];
                if (last.tag != tag || last.tagtype != 0) {
                    if (last.tagtype != 0) {
                        if (subtype == -1) {
                            addWarning([[errorMsgAt('Passage ended with an unmatched tag  at ', passage, last.pos)]], passage.header);
                        } else {
                            addWarning([[errorMsgAt('Closing unmatched tag ', passage, last.pos) + errorMsgAt(' before ', passage, pos)]], passage.header);
                        }
                        stack.pop();
                        continue;
                    }
                    break;
                }
                return idx + 1;
            }
        }
        return 0;
    }
    // find (macro) name at the given position optionally in quotes skipping leading whitespaces
    function tagQNameAt(html, pos) {
        while (html.charAt(pos).match(/\s/)) {
            pos++;
        }
        const qc = html.charAt(pos);
        const inQuot = qc === '"' || qc === '\'';
        pos += inQuot ? 1 : 0;
        const start = pos;
        do {
            pos++;
        } while (html.charAt(pos).match(/[\w-]/));
        const end = pos;
        if (inQuot) {
            if (html.charAt(pos) === qc) {
                pos++;
            } else {
                return 0;
            }
        }
        return [start, pos, html.substring(start, end)];
    }

    // find macro name at the given position with optional leading whitespaces
    function tagNameAt(html, pos) {
        while (html.charAt(pos).match(/\s/)) {
            pos++;
        }
        const start = pos;
        if (html.charAt(pos).match(/[a-zA-Z]/)) {
            do {
                pos++;
            } while (html.charAt(pos).match(/[\w-]/));
        }
        return [start, pos, html.substring(start, pos)];
    }

    function indexOfMacro(html, name, index) {
        while (true) {
            index = html.indexOf('<<', index);
            if (index === -1) break;
            const nameAt = tagNameAt(html, index + 2);
            const tagName = nameAt[2];
            if (tagName != name) {
                index = nameAt[1];
                continue;
            }
            break;
        }
        return index;
    }

    const htmlTags = new Set(['div', 'b', 'strong', 'strike', 'u', 'i', 'li', 'ul', 'h1', 'h2', 'h3', 'p', 'table', 'tbody', 'th', 'tr', 'td', 'label', 'span', 'a', 'link', 'button', 'center']);

    function matchTags(html, passage) {
        var cursor = 0;
        var stack = [];
        while (true) {
            cursor = html.indexOf('<', cursor);
            if (cursor === -1) {
                digStackForTag(stack, '', -1, 0, passage);
                const idx = stack.length-1;
                if (idx >= 0) {
                    return throwError(errorMsgAt('Unmatched tag at ', passage, stack[idx].pos), passage);
                }
                return; // done;
            }
            cursor++;
            var next, type = 0, subtype = 0, isMacro = 0;
            var nextPos = -1;
            if (html.charAt(cursor) == '<') {
                cursor++;
                // double opening -> possible SugarCube macro
                if (html.charAt(cursor) == '/') {
                    cursor++;
                    // macro closing
                    type = 1;
                }
                const nameAt = tagNameAt(html, cursor);
                if (nameAt[0] != nameAt[1]) {
                    const tagName = nameAt[2];
                    next = tagName;
                    nextPos = cursor-2;
                    if (type != 0) {
                        nextPos--;
                        if (html.charAt(nameAt[1]) != '>' || html.charAt(nameAt[1] + 1) != '>') {
                            return throwError(errorMsgAt('Broken closing macro at ', passage, nextPos), passage);
                        }
                    }
                    isMacro = allMacros[next];
                    if (!isMacro) {
                        return throwError(errorMsgAt(type == 0 ? `Unrecognized macro at ` : `Unrecognized macro close at `, passage, nextPos), passage);
                    }
                    if (!isMacro.closed) {
                        if (type != 0) {
                            return throwError(errorMsgAt(`Macro should not be closed, but was at `, passage, nextPos), passage);
                        }
                        if (isMacro.replacend) {
                            next = isMacro.replacend;
                            type = 1;
                        } else if (!isMacro.ctx) {
                            continue;
                        } else {
                            var ctx = isMacro.ctx[0];
                            if (isMacro.ctx.length > 1) {
                                ctx = 0;
                                var bestIdx = 0, bestOption = 0;
                                for (const pc of isMacro.ctx) {
                                    const pidx = digStackForTag(stack, pc.main, 2, nextPos, 0);
                                    if (pidx) {
                                        if (!pc.ordered || pidx == stack.length) {
                                            ctx = pc;
                                            break;
                                        }
                                        if (bestIdx < pidx) {
                                            bestIdx = pidx;
                                            bestOption = pc;
                                        }
                                    }
                                }
                                if (!ctx) {
                                    if (bestOption) {
                                        // there is an open context, but the order does not match -> do not force it, just emit a warning
                                        addWarning([[errorMsgAt(`Skipping order check of `, passage, index)]], passage.header);
                                        continue;
                                    }
                                    // none of the possible contexts are open -> select one to crash with
                                    ctx = isMacro.ctx[0];
                                }
                            }
                            next = ctx.main;
                            type = ctx.last ? -2 : -1;
                            subtype = ctx.ordered ? 0 : 2;
                        }
                    }
                } else if (type == 1) {
                    return throwError(errorMsgAt(`Unrecognized closing at `, passage, cursor - 3), passage);
                } else {
                    const fc = html.charAt(nameAt[0]);
                    if (fc !== '-' && fc !== '=') {
                        return throwError(errorMsgAt(`Invalid macro at `, passage, cursor - 2), passage);
                    }
                }
            } else {
                // single opening -> possible html tag
                subtype = 1;
                if (html.charAt(cursor) == '/') {
                    cursor++;
                    // tag closing
                    type = 1;
                }
                const nameAt = tagNameAt(html, cursor);
                if (nameAt[0] != nameAt[1]) {
                    const tagName = nameAt[2];
                    if (htmlTags.has(tagName)) {
                        next = tagName;
                        nextPos = cursor-1;
                        if (type != 0) {
                            nextPos--;
                            if (html.charAt(nameAt[1]) != '>') {
                                return throwError(errorMsgAt('Broken closing tag at ', passage, nextPos), passage);
                            }
                        }
                    }
                }
            }
            if (nextPos === -1) {
                continue;
            }
            // update/check stack
            if (type == 0) {
                // standard opening tag -> add to stack
                stack.push({tag:next, type:0, tagtype:subtype, pos: nextPos});
            } else if (type < 0) {
                // special sub-opening tags ('elseif' / 'else' , 'case' / 'default')
                type = -type;
                if (!digStackForTag(stack, next, subtype, nextPos, passage)) {
                    const hider = hiderTag(stack, next);
                    if (hider == null) {
                        // missing if/switch/for
                        return throwError(errorMsgAt(`Missing '${next}' before `, passage, nextPos), passage);
                    } else {
                        // unmatched tags between (switch|case / case|default) or (if|elseif / else|elseif) tags
                        return throwError(errorMsgAt('Mangled tag at ', passage, nextPos) + errorMsgAt(', after unmatched tag at ', passage, hider.pos), passage);
                    }
                }
                if (subtype == 0) {
                    const idx = stack.length-1;
                    if (stack[idx].type === 2) {
                        // 'else' / 'default' already found
                        return throwError(errorMsgAt('Branch already in its last stage at ', passage, nextPos), passage);
                    }
                    stack[idx].type = type;
                    stack[idx].pos = nextPos;
                }
            } else {
                // closing tags
                if (!digStackForTag(stack, next, subtype, nextPos, passage)) {
                    const hider = hiderTag(stack, next);
                    if (hider == null) {
                        return throwError(errorMsgAt('Unmatched tag at ', passage, nextPos), passage);
                    } else {
                        return throwError(errorMsgAt('Mangled tag at ', passage, nextPos) + errorMsgAt(', after unmatched tag at ', passage, hider.pos), passage);
                    }
                }
                stack.pop();
            }
            cursor = nextPos + 3;
        }
    }
    // eliminate expressions in quotes and comments
    function replaceText(expr) {
        while (true) {
            var qIdx = expr.indexOf('\'');
            var wIdx = expr.indexOf('"');
            var cIdx = expr.indexOf('/*');

            if (qIdx == -1) qIdx = Infinity;
            if (wIdx == -1) wIdx = Infinity;
            if (cIdx == -1) cIdx = Infinity;

            if (qIdx < wIdx) {
                if (qIdx < cIdx) {
                    var next = expr.replace(/'[^']*'/, ' x ');
                    if (next != expr) {
                        expr = next;
                        continue;
                    }
                    break;
                }
            }
            if (cIdx < wIdx) {
                var next = expr.replace(/[ ]*\/\*[^*]*\*\/[ ]*/, ' ');
                if (next != expr) {
                    expr = next;
                    continue;
                }
                break;
            }
            if (wIdx < cIdx) {
                var next = expr.replace(/"[^"]*"/, ' x ');
                if (next != expr) {
                    expr = next;
                    continue;
                }
                break;
            }
            break;
        }
        return expr;
    }

    function findInvalidConditions(html, passage) {
        const pi = /<<[^>]* (is(not)?|not) (gt|gte|lt|lte|eq|neq|def|ndef) [^>]*>>/g;
        let matches = html.match(pi);
        if (matches) {
            for (const match of matches) {
                if (match.match(/[^^]<</)) continue;
                const expr = replaceText(match);
                if (!expr.match(pn)) continue;
                addError(`Invalid condition found: '${match}', is/isnot should not be used in combination with other comparators`, passage);
            }
        }
        const pn = /<<[^>]* is not [^>]*>>/g;
        matches = html.match(pn);
        if (matches) {
            for (const match of matches) {
                if (match.match(/[^^]<</)) continue;
                const expr = replaceText(match);
                if (!expr.match(pn)) continue;
                addWarning([[`Unexpected condition found: '${match}'. Is this intended?`]], passage.header);
            }
        }
        const pc = /<<[^>]*([^<]<[^<]|[^>=]>[^>]|&&)[^>]*>>/g;
        matches = html.match(pc);
        if (matches) {
            for (const match of matches) {
                if (match.match(/[^^]<</)) continue;
                const expr = replaceText(match);
                if (!expr.match(pc)) continue;
                addWarning([[`Non-standard condition found: '${match}'. Use [lte|lt|gte|gt|and] instead?`]], passage.header);
            }
        }
    }

    function findInvalidSetters(html, passage) {
        for (var index = 0; ; index += 5) {
            // find widget macro
            index = html.indexOf('<<set', index);
            if (index === -1) break;
            const start = index + 5;
            const endPos = html.indexOf('>>', start);
            if (endPos == -1) {
                continue; // unclosed setter should be reported by matchTags
            }
            var expr = html.substring(start, endPos);
            if (!expr.match(/^\s/)) {
                continue;
            }

            // expr = expr.replace(/\/\/.*\n/g, ' '); // get rid of comments at the end of the lines

            // expr = expr.replace(/x/g, 'y'); // reserve x

            expr = replaceText(expr);

            expr = expr.trim();

            expr = expr.replace(/\s/g, ' '); // use 'standard' spacing

            expr = expr.replace(/([^\w\$.^)}\]])new /g, '$1'); // eliminate allocations
            expr = expr.replace(/([^\w\$.^)}\]])([!~^])([^.)}\]])/g, '$1 $3'); // eliminate unary operators

            expr = expr.replace(/ to /g, ' ='); // use standard assign operator
            expr = expr.replace(/ (or|and) /g, ' & '); // use standard boolean operators
            expr = expr.replace(/([^\w$])(not|def|ndef) /g, '$1 '); // eliminate non-standard unary operators
            expr = expr.replace(/ (isnot|is|lte|gte|gt|lt|eq|neq) /g, ' < '); // use standard comparators

            expr = expr.replace(/[+-][ ]*[+-]/g, '+'); // merge consecutive signs
            expr = expr.replace(/([<:?,=({\[])[ ]*[+-]/g, '$10+'); // eliminate leading signs

            expr = expr.replace(/[$_]?[a-zA-Z][\w]*/g, 'x'); // replace variables

            expr = expr.replace(/[0-9]*[\.]?[0-9]+/g, 'x'); // replace numbers

            expr = expr.replace(/(===|!==|==|!=|<=|>=|&&|\|\|)/g, '&'); // use single operators

            expr = expr.replace(/[<%|+-]/g, '&'); // use one (&) type of operator
            expr = expr.replace(/([^\/])\*([^\/])/g, '$1&$2');
            expr = expr.replace(/([^*])\/([^*])/g, '$1&$2');

            expr = expr.replace(/&=/g, ' ='); // use assign operator instead of modifier operators

            var wcos = expr.match(/(x[\s]+\(|\.[\s]+x)/); // report cosmetic issue for '. member' and 'func ()' patterns

            while (true) {
                var next = expr.replace(/,[\s]*([,})\]])/g, '$1'); // merge empty expressions in maps/arrays
                next = next.replace(/([{\[])[\s]*,/g, '$1');
                if (next != expr) {
                    expr = next;
                    continue;
                }
                break;
            }

            expr = expr.replace(/[ ]+/g, ' '); // use single spacing
            expr = expr.replace(/[ ]*([^ x])[ ]*/g, '$1'); // eliminate spacing around brackets, commas and colons

            // expr = expr.replace(/{([^}]*)}/g, '[$1]'); // convert maps to 'arrays'

            while (true) {
                var next = expr.replace(/([x})\]])\.x(\(\)|$)/g, '$1'); // eliminate member references
                next = next.replace(/([x})\]])\.x([^(])/g, '$1$2');
                next = next.replace(/(x|x\(\)|x?\(x\)|x?\[\])[ ]*&[ ]*(x|x\(\)|\(x\)|\[\])/g, 'x'); // 'resolve' binary operators
                next = next.replace(/(x|x\(\)|x?\(x\)|x?\[\])\?(x|x\(\)|\(x\)|\[\]|{}):(x|x\(\)|\(x\)|\[\]|{})/g, 'x'); // 'resolve' ternary operators
                next = next.replace(/([({\[])x,[ ]*x/g, '$1x'); // eliminate extra parameters
                next = next.replace(/x\(x\)/g, 'x()'); // eliminate last parameters x(x) -> x()
                next = next.replace(/\[x\]/g, '[]'); // [x] -> []
                next = next.replace(/{x}/g, '{}'); // {x} -> {}
                next = next.replace(/([ &=])[ ]*\(x\)/g, '$1x'); // resolve groups   op(x) -> op_x
                next = next.replace(/\(x\)[ ]*&/g, 'x&'); //       (x)op -> x_op
                next = next.replace(/([,({\[])(x\(\)|\[\]|{})([)},\]])/g, '$1x$3'); // eliminate parameters of inner calls ,x(), -> ,x, ...  ,[], -> ,x, ...,{}, -> ,x,
                next = next.replace(/([&=])[ ]*x(\(\)|\[\])/g, '$1x');  // eliminate parameters of inner calls =x() -> =x ...  +x() -> +x
                next = next.replace(/\[([^\]]*)x\(\)([^\]]*)\]/g, '[$1x$2]'); // eliminate parameters of inner calls [..x()..] -> [..x..]
                next = next.replace(/{([^}]*)x\(\)([^}]*)}/g, '{$1x$2}');     //                               {..x()..} -> {..x..}
                next = next.replace(/([{,])x[ ]*:[ ]*(x|x\(\)|\(x\)|\[\]|{})[ ]*([,}])/g, '$1x$3'); //                                   {..,x:x,..} -> {..x..}
                next = next.replace(/([x)}\]])\[\]/g, '$1'); // eliminate index acccesses x[] -> x
                if (next != expr) {
                    expr = next;
                    continue;
                }
                break;
            }

            expr = expr.replace(/=[ ]*(\[\]|{})/g, '=x'); // eliminate empty assignments  =[] -> =x

            const asgns = expr.split(/[,;]/);
            if (asgns.length == 0) {
                addWarning([[errorMsgAt(`Empty assignment at `, passage, index)]], passage.header);
            }

            var msg = wcos ? `Cosmetic issue at ` : 0;
            for (var i = 0; i < asgns.length; i++) {
                const asgn = asgns[i];
                if (asgn.match(/^x[ ]*=[ ]*x$/)) continue;

                if (asgn == '') {
                    if (!msg && i != asgns.length - 1) {
                        msg = `Empty mid-assignment at `;
                    }
                    continue;
                } else if (asgn.match(/^x([ ]*=[ ]*x)+$/)) {
                    msg = `Multi-assign at `;
                } else if (asgn == 'x()') {
                    msg = `Not an assignment at `;
                } else {
                    msg = `Could not parse assignment at `;
                }
                break;
            }
            if (msg) {
                addWarning([[errorMsgAt(msg, passage, index)]], passage.header);
            }
        }
    }

    const deprecatedScripts = [
        ['state.active.variables', 'State.variables'],
        ['State.initPRNG(', 'State.prng.init('],
        ['.containsAll(', '.includesAll('],
        ['.containsAny(', '.includesAny('],
        ['.flatten(', '.flat('],
        ['macros.', 'Macro.add('],
    ];
    const deprecatedMacros = [
        ['<<click', '<<link'],
        ['<<endclick>>', '<</link>>'],
        ['<</click>>', '<</link>>'],
        ['<<endif>>', '<</if>>'],
        ['<<endnobr>>', '<</nobr>>'],
        ['<<endsilently>>', '<</silently>>'],
        ['<<endfor>>', '<</for>>'],
        // ['<<endscript>>', '<</script>>'],
        ['<<endbutton>>', '<</button>>'],
        ['<<endappend>>', '<</append>>'],
        ['<<endprepend>>', '<</prepend>>'],
        ['<<endreplace>>', '<</replace>>'],
        ['<<endwidget>>', '<</widget>>'],
        ['<<setplaylist', '<<createplaylist'],
        ['<<stopallaudio>>', '<<audio ":all" stop>>'],
        ['<<display', '<<include'],
        ['<<forget', 'forget()'],
        ['<<remember', `memorize()' and 'recall()`],
    ];
    function findDeprecatedInPassage(html, passage) {
        for (const dep of deprecatedMacros) {
            const index = html.indexOf(dep[0]);
            if (index !== -1) {
                addWarning([[errorMsgAt(`Deprecated '${dep[0]}' (should be '${dep[1]}') found at `, passage, index)]], passage.header);
            }
        }
        for (const dep of deprecatedScripts) {
            const index = html.indexOf(dep[0]);
            if (index !== -1) {
                addWarning([[errorMsgAt(`Deprecated '${dep[0]}' (should be '${dep[1]}') found at `, passage, index)]], passage.header);
            }
            for (var idx = passage.exclusions.length - 1; idx >= 0; idx--) {
                const excl = passage.exclusions[idx];
                if (excl.type <= 0) {
                    if (excl.type < 0) {
                        addWarning([[errorMsgAt(`Deprecated '<<endscript>>' (should be '<</script>>') found at `, passage, excl.start)]], passage.header);
                    }
                    const index = excl.text.indexOf(dep[0]);
                    if (index !== -1) {
                        addWarning([[htmlErrorAt(`Deprecated '${dep[0]}' (should be '${dep[1]}') found in script `, excl.text, 0)]], passage.header);
                    }
                }
            }
        }
    }

    function findDeprecatedInScript() {
        const initialIndex = fileData.indexOf('id="twine-user-script"');
        if (initialIndex === -1) return;
        const maxIndex = fileData.indexOf('</script>', initialIndex);
        for (const dep of deprecatedScripts) {
            let cursor = initialIndex;
            while (true) {
                cursor = fileData.indexOf(dep[0], cursor);
                if (cursor === -1) break;
                if (cursor >= maxIndex) break;
                if (dep[0][0] !== '.') { // Special case, ignore if this is not stand-alone
                    const precedingChar = fileData[cursor - 1];
                    if (precedingChar.match(/[\w\.]/)) {
                        cursor++;
                        continue;
                    }
                }
                const endOfLineIndex = fileData.indexOf('\n', cursor);
                const lines = fileData.substring(0, endOfLineIndex).split('\n');
                const line = lines[lines.length - 1].trim();
                addWarning([
                    ['Line $$1: $$2', lines.length, line],
                    ["'$$1' should be '$$2'", dep[0], dep[1]],
                ], 'Deprecated code found in Twine User-script');
                cursor++;
            }
        }
    }

    function parseCss(html, startIndex, contentIndex, endIndex) {
        const line = textLines(html.substring(0,startIndex));
        const header = html.substring(startIndex, contentIndex);
        var content = html.substring(contentIndex, endIndex);
        const exclusions = [];
        var deccontent = '';
        const markup = ['/*', '*/'];
        while (true) {
            const start = content.indexOf(markup[0], 0);
            if (start == -1) {
                break;
            }
            // If something is found, find the matching closing markup
            const end = content.indexOf(markup[1], start + markup[0].length);
            // If no closing markup is found, add a warning and stop trying to exclude further markup
            if (end === -1) {
                addWarning([[htmlErrorAt(`Opening '${markup[0]}' without closing '${markup[1]}' at `, content, start)]], header);
                break;
            }
            // cut the excluded markup from the html-content
            const text = content.substring(start + markup[0].length, end);
            // add the content prior to the excluded markup
            deccontent += content.substr(0, start);
            content = content.substring(end + markup[1].length);
            exclusions.push({ type: 1, start: deccontent.length, text });
        }
        // decode the remaining content
        content = deccontent + content;
        return { header, content, exclusions, line };
    }

    function checkCssInScript() {
        const initialIndex = fileData.indexOf('id="twine-user-stylesheet"');
        const startIndex = fileData.lastIndexOf('<style', initialIndex);
        if (startIndex === -1) return;
        const contentIndex = fileData.indexOf('>', startIndex) + 1;
        const endIndex = fileData.indexOf('</style>', initialIndex);
        if (endIndex === -1 || contentIndex === -1) return addHtmlError(htmlErrorAt('Unclosed stylesheet at ', fileData, startIndex), 'user-stylesheet');
        const style = parseCss(fileData, startIndex, contentIndex, endIndex);
        const html = style.content;
        let cursor = 0;
        let cssStack = new Map();
        while (true) {
            var start = html.indexOf('{', cursor);
            if (start == -1) {
                break;
            }
            let end, bs = 0, cur = start;
            while (true) {
                cur++;
                end = html.indexOf('}', cur);
                let nb = html.indexOf('{', cur);
                if (nb != -1 && nb < end) {
                    bs++;
                    cur = nb;
                    continue;
                }
                if (bs != 0 && end != -1) {
                    bs--;
                    cur = end;
                    continue;
                }
                break;
            }
            if (end == -1) {
                return addHtmlError(errorMsgAt('Unclosed css at ', style, start), style.header);
            }
            var begin = Math.max(html.lastIndexOf(';', start),html.lastIndexOf('}', start))+1;
            while (html[begin].match(/\s/)) {
                begin++;
            }
            let names = html.substring(begin, start).split(',');
            let params = html.substring(start+1, end).split(';');
            let ps = new Set();
            for (var index = params.length - 1; index >= 0; index--) {
                var entry = params[index];
                entry = entry.replace(/:.*/,'').trim();
                if (ps.has(entry)) {
                    addWarning([[errorMsgAt(`Duplicate '${entry}' css-attribute at `, style, begin)]], style.header);
                }
                ps.add(entry);
            }
            const multi = names.length != 1;
            for (var index = names.length - 1; index >= 0; index--) {
                const name = names[index].trim();
                if (name == '' || name[0] == '@') continue;
                if (cssStack.has(name)) {
                    for (const css of cssStack.get(name)) {
                        if (css.params.isSubsetOf(ps)) {
                            addWarning([[errorMsgAt(`Definition at `, style, css.begin) + errorMsgAt(` overwritten at `, style, begin)]], style.header);
                        } else if (!css.multi) {
                            if (!multi) {
                                addWarning([[errorMsgAt(`Merge definition at `, style, css.begin) + errorMsgAt(` with css at `, style, begin)]], style.header);
                            } else if (!css.params.isDisjointFrom(ps)) {
                                addWarning([[errorMsgAt(`Attribute(s) at `, style, css.begin) + errorMsgAt(` overwritten at `, style, begin)]], style.header);
                            }
                        }
                    }
                } else {
                    cssStack.set(name, []);
                }
                cssStack.get(name).push({ params: ps, multi, begin });
            }
            cursor = end;
        }
    }

    // Native macros
    const sugarMacros = new Set();
    const allMacros = {};
    function addComplexMacro(name, subs, ordered) {
        sugarMacros.add(name);
        allMacros[name] = { closed: 1 };
        for (const sub of subs) {
            sugarMacros.add(sub);
            if (!allMacros[sub]) allMacros[sub] = {};
            if (!allMacros[sub].ctx) allMacros[sub].ctx = [];
            allMacros[sub].ctx.push({ main: name, ordered: ordered, last: sub == subs[subs.length - 1] });
        }
    }
    function addSimpleMacro(name, closed) {
        sugarMacros.add(name);
        allMacros[name] = { closed };
    }
    function addDeprecatedEndMacro(name) {
        sugarMacros.add(name);
        allMacros[name] = { replacend: name.substring(3) };
    }
    // Closed
    // - simple
    ['capture', 'click', 'do', 'done', 'script', 'nobr', 'silent', 'type', 'button', 'link', 'linkappend', 'linkprepend', 'linkreplace', 'append', 'prepend', 'replace', 'widget',
     'display', 'forget', 'remember', 'setplaylist', 'silently', 'stopallaudio'].forEach((name) => addSimpleMacro(name, 1));
    // - complex
    [['if', [ 'elseif', 'else'], 1], ['switch', [ 'case', 'default'], 1], ['for', [ 'break', 'continue'], 0], ['repeat', [ 'stop' ], 0], ['cycle', [ 'option', 'optionsfrom '], 0], ['listbox', [ 'option', 'optionsfrom '], 0],
         ['timed', [ 'next' ], 0], ['createaudiogroup', [ 'track' ], 0], ['createplaylist', [ 'track' ], 0] ].forEach((entry) => addComplexMacro(entry[0], entry[1], entry[2]));
    // Unclosed
    ['set', 'unset', 'run', '=', '-', 'include', 'print', 'checkbox', 'radiobutton', 'textarea', 'textbox', 'numberbox', 'actions', 'back', 'choice', 'return', 'addclass'].forEach((name) => addSimpleMacro(name, 0));
    ['copy', 'remove', 'removeclass', 'toggleclass', 'audio', 'cacheaudio', 'playlist', 'masteraudio', 'removeplaylist', 'waitforaudio', 'removeaudiogroup', 'redo', 'goto'].forEach((name) => addSimpleMacro(name, 0));
    // Deprecated endings
    ['endclick', 'endif', 'endfor', 'endnobr', 'endscript', 'endsilently', 'endbutton', 'endappend', 'endprepend', 'endreplace', 'endwidget'].forEach((name) => addDeprecatedEndMacro(name));

    function tryEvalMacro(script) {
        const Macro = {
            add(name, { tags }) {
                if (name instanceof Array)
                    return name.map((n) => ({name: n, tags}));
                else
                    return [{ name , tags }];
            }
        }
        try {
            return eval(script);
        } catch (e) {
            return false;
        }
    }

    function loadIgnoredMacros() {
        if (localStorage) {
            const names = Object.keys(localStorage);
            for (const name of names) {
                if (!allMacros[name]) {
                    allMacros[name] = localStorage[name];
                }
            }
        }
    }
    function findAllCustomMacros() {
        const scriptStartIndex = fileData.indexOf('id="twine-user-script"');
        if (scriptStartIndex === -1) return;
        const scriptEndIndex = fileData.indexOf('</script>', scriptStartIndex);
        if (scriptEndIndex === -1) return;
        const macroStartSyntax = 'Macro.add(';
        let index = scriptStartIndex;
        while (true) {
            index = fileData.indexOf(macroStartSyntax, index);
            if (index === -1 || index > scriptEndIndex) break;
            let cursor = index;
            while (true) {
                cursor = fileData.indexOf(')', cursor);
                if (cursor === -1 || cursor > scriptEndIndex) {
                    addWarning([[htmlErrorAt(`Could not evaluate macro at `, fileData, index)]], 'user-script');
                    index++;
                    break;
                }
                cursor++;
                const macroCode = fileData.substring(index, cursor);
                const results = tryEvalMacro(macroCode);
                if (results !== false) {
                    for (const result of  results) {
                        const { name , tags } = result;
                        if (sugarMacros.has(name)) addWarning([[htmlErrorAt(`Custom macro conflict at `, fileData, index)]], 'user-script');
                        else if (tags && tags.length) addComplexMacro(name, tags, 0);
                        else addSimpleMacro(name, tags !== undefined);
                    }
                    index = cursor;
                    break;
                }
            }
        }
    }

    function findAllCustomMacrosDeprecated() {
        const scriptStartIndex = fileData.indexOf('id="twine-user-script"');
        if (scriptStartIndex === -1) return;
        const scriptEndIndex = fileData.indexOf('</script>', scriptStartIndex);
        if (scriptEndIndex === -1) return;
        const macroStartSyntax = '/macros';
        let index = scriptStartIndex;
        while (true) {
            index = fileData.indexOf(macroStartSyntax, index);
            if (index === -1 || index > scriptEndIndex) break;
            if (!fileData.charAt(index+1).match(/\s/)) {
                index++;
                continue;
            }
            const innerStartIndex = fileData.indexOf('{', index);
            // parse the name
            const qNameAt = tagQNameAt(fileData, index);
            if (!qNameAt || innerStartIndex === -1) {
                addWarning([[htmlErrorAt(`Could not parse deprecated macro at `, fileData, index)]], 'user-script');
                index++;
                continue;
            }
            const macroName = qNameAt[2];

            let cursor = innerStartIndex;
            while (true) {
                cursor = fileData.indexOf('}', cursor);
                if (cursor === -1 || cursor > scriptEndIndex) {
                    addWarning([[htmlErrorAt(`Could not evaluate deprecated macro at `, fileData, index)]], 'user-script');
                    index++;
                    break;
                }
                cursor++;
                const macroCodeObj = fileData.substring(innerStartIndex, cursor);
                const macroCode = `Macro.add('${macroName}', ${macroCodeObj})`;
                const result = tryEvalMacro(macroCode);
                if (result !== false) {
                    const { name , tags } = result;
                    if (sugarMacros.has(name)) addWarning([[htmlErrorAt(`Deprecated macro conflict at `, fileData, index)]], 'user-script');
                    else if (tags && tags.length) addComplexMacro(name, tags, 0);
                    else addSimpleMacro(name, tags !== undefined);
                    index = cursor;
                    break;
                }
            }
        }
    }

    function findAllWidgets(html, passage) {
        // Check whether the passage is a 'widget'-passage
        const tags = getHTMLAttr(passage.header, 'tags');
        const isWidget = tags && tags.split(' ').indexOf('widget') != -1;
        // Find all widgets
        let index = 0;
        while (true) {
            // find widget macro
            index = indexOfMacro(html, 'widget', index);
            if (index === -1) break;
            if (!isWidget) {
                addError(errorMsgAt('Widget without a widget tag at ', passage, index), passage);
                break;
            }
            index += 9;
            // parse the name
            const qNameAt = tagQNameAt(html, index);
            if (qNameAt && qNameAt[0] != qNameAt[1]) {
                const end = qNameAt[1];
                if (html.charAt(end).match(/[\s>]/)) {
                    const widgetName = qNameAt[2];
                    if (sugarMacros.has(widgetName)) addError(errorMsgAt(`Widget/macro '${widgetName}' redefinition at `, passage, index - 9), passage);
                    else addSimpleMacro(widgetName, 0);
                    index = end;
                    continue;
                }
            }
            addError(errorMsgAt(`Invalid widget definition at `, passage, index - 9), passage);
        }
    }

    // First find all widgets and macros, so we can validate them later
    findAllCustomMacros();
    findAllCustomMacrosDeprecated();
    loadIgnoredMacros();
    for (const passage of passages) {
        findAllWidgets(passage.content, passage);
    }
    for (const passage of passages) {
        try {
            matchQuotes(passage.content, passage);
            matchGTLT(passage.content, passage);
            matchTags(passage.content, passage);
            findDeprecatedInPassage(passage.content, passage);
            findInvalidConditions(passage.content, passage);
            findInvalidSetters(passage.content, passage);
        } catch(e) {
            if (e.message != 'Error' && e.stack) {
                addError('Unhandled Exception: ' + e.stack, passage);
            }
        }
    }
    findDeprecatedInScript();
    checkCssInScript();
    findIdConflicts();

    return {
        errors: validationErrors,
        warnings: validationWarnings,
        infos: validationInfos,
    };
}

if (typeof module !== 'undefined') module.exports = validate;
