function validate(fileData, localStorage = {}) {
    const validationErrors = {};
    const validationWarnings = {}

    const entityMap = {
        '&lt;': '<',
        '&gt;': '>',
        '&quot;': '"',
        '&#39;': `'`,
        '&amp;': '&',
        '\t': '  ',
    };
    function decodeHTML(encodedStr) {
        const input = Object.keys(entityMap);
        for(const k of input) {
            const v = entityMap[k];
            encodedStr = encodedStr.replaceAll(k,v);
        }
        return encodedStr;
    }

    function recodeHTML(str) {
        const recodeMap = Object.keys(entityMap).reduce((map, key) => {
            const intermediate = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER).toString(36) + Math.floor(Math.random() * Number.MAX_SAFE_INTEGER).toString(36);
            return [
                ...map,
                { replace: key, intermediate, find: entityMap[key] },
            ];
        }, []);
        // Find replace find's with intermediate's
        for (const { replace, intermediate, find } of recodeMap) {
            str = str.replaceAll(find, intermediate);
        }
        // Then replace intermediate's with replace's
        for (const { replace, intermediate, find } of recodeMap) {
            str = str.replaceAll(intermediate, replace);
        }
        return str;
    }

    const exclusionMarkup = [
        ['"""', '"""'], // Markup escape
        ['<nowiki>', '</nowiki>'],
        ['{{{', '}}}'],
        ['/*', '*/'],
        ['/%', '%/'],
        ['<!--', '-->'],
        ['<<script>>', '<</script>>'] // script
    ];
    function recodeExcludedHTML(html, header) {
        let startIndex = 0;
        while(true) {
            let firstIndex = Infinity;
            let firstMarkup = null;
            for(const markup of exclusionMarkup) {
                const index = html.indexOf(markup[0], startIndex);
                if (index !== -1 && index < firstIndex) {
                    firstIndex = index;
                    firstMarkup = markup;
                }
            }
            // If none of the opening markup can be found, we're done
            if (!firstMarkup) {
                return html;
            }
            // If something is found, find the matching closing markup
            const closingIndex = html.indexOf(firstMarkup[1], firstIndex + firstMarkup[0].length);
            // If no closing markup is found, add a warning and stop trying to exclude further markup
            if (closingIndex === -1) {
                addWarning([[errorMsgAt(`Found opening '${firstMarkup[0]}' without closing '${firstMarkup[1]}' at `, html, firstIndex)]], header);
                return html;
            }
            // modify html to re-encode the excluded markup
            html = html.substr(0, firstIndex + firstMarkup[0].length) + recodeHTML(html.substring(firstIndex + firstMarkup[0].length, closingIndex)) + html.substr(closingIndex);
            startIndex = closingIndex + firstMarkup[1].length;
        }
    }
    
    function getHTMLAttr(html, attr) {
        const startStr = `${attr}="`;
        const start = html.indexOf(startStr);
        if (start === -1) return null;
        const end = html.indexOf('"', start + startStr.length);
        if (end === -1) return null;
        return html.substring(start + startStr.length, end);
    }

    const passageStartTag = '<tw-passagedata';
    const passageCloseTag = '</tw-passagedata>';
    const passages = [];
    // const passageNameIndex = {};
    // const passageIdIndex = {};
    let lastIndex = 0;
    while(true) {
        const startIndex = fileData.indexOf(passageStartTag, lastIndex);
        if (startIndex === -1) break;
        const endIndex = fileData.indexOf(passageCloseTag, startIndex);
        if (endIndex === -1) throw 'Unclosed passage found: ' + fileData.substr(startIndex, 200);
        const contentIndex = fileData.indexOf('>', startIndex) + 1;
        const header = fileData.substring(startIndex, contentIndex);
        const content = recodeExcludedHTML(decodeHTML(fileData.substring(contentIndex, endIndex)), header);
        //const id = getHTMLAttr(header, 'pid');
        //const name = getHTMLAttr(header, 'name');
        const passage = { header, content }; //, id, name };
    
        // Add stuff
        passages.push(passage);
        // if (name) passageNameIndex[name] = passage;
        // if (id) passageIdIndex[id] = passage;
        lastIndex = endIndex + 16; //passageCloseTag.length;
    }
    function errorMsgAt(prefix, html, pos) {
        return prefix + html.substring(pos, pos + 40);
    }
    function addError(msg, passage) {
        if (!validationErrors[passage.header]) validationErrors[passage.header] = [];
        validationErrors[passage.header].push(msg.replace(/\n/g, '\\n').replace(/\t/g, '\\t'));
    }
    function throwError(msg, passage) {
        addError(msg, passage);
        throw 'Error';
    }

    function addWarning(msg, header) {
        if (!validationWarnings[header]) validationWarnings[header] = [];
        validationWarnings[header].push(msg);
    }

    function matchQuotes(html, passage) {
        const numDoubleQuotes = html.split('"').length - 1;
        // const numSingleQuotes = html.split("'").length - 1;
        const unevenDoubleQuotes = (numDoubleQuotes % 2) === 1;
        // const unevenSingleQuotes = (numSingleQuotes % 2) === 1; // single quotes can reasonably be used in plain english
        if (unevenDoubleQuotes) addWarning([['Uneven number of double-quotes in passage']], passage.header);
        // if (unevenSingleQuotes) addWarning([['Uneven number of single-quotes in']], passage.header);
    }
    
    function matchGTLT(html, passage) {
        var cursor = 0;
        var stack = [];
        while(true) {
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
                    return throwError(errorMsgAt(`Found an closing '>>' without matching '<<' at `, html, nextEnd) , passage);
                }
                stack.pop();
                cursor = nextEnd + 2;
                continue;
            }
            if (idx >= 0) {
                return throwError(errorMsgAt(`Found an opening '<<' without matching '>>' at `, html, stack[idx]) , passage);
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

    function digStackForTag(stack, tag, subtype, pos, html, passage) {
        if (subtype == 1) {
            // html tag -> fake success
            var fake = 1;
            if (stack.length != 0) {
                const last = stack[stack.length-1];
                if (last.tag != tag || last.tagtype != 1) {
                    addWarning([[errorMsgAt('Unmatched tag at ', html, pos)]], passage.header);
                } else {
                    fake = 0;
                }
            }
            if (fake) {
                stack.push({});
            }
            return true;
        }
        // SugarCube macro
        if (subtype == 2) {
            // - requires an opening tag somewhere
            for (const entry of stack) {
                if (entry.tag == tag && entry.tagtype == 0) {
                    return true;
                }
            }
        } else {
            // - requires a direct opening tag
            while (stack.length != 0) {
                const last = stack[stack.length-1];
                if (last.tag != tag || last.tagtype != 0) {
                    if (last.tagtype != 0) {
                        addWarning([[errorMsgAt('Unmatched tag at ', html, last.pos)]], passage.header);
                        stack.pop();
                        continue;
                    }
                    break;
                }
                return true;
            }
        }
        return false;
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
        return [start, end, inQuot];
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
        return [start, pos];
    }

    function matchTags(html, passage) {
        const htmlTags = ['div', 'b', 'strong', 'strike', 'u', 'i', 'li', 'ul', 'h1', 'h2', 'h3', 'p', 'table', 'tbody', 'th', 'tr', 'td', 'label', 'span', 'a', 'link', 'button', 'center'];
        const sugarMacros = ['if', 'elseif', 'else', 'switch', 'case', 'default', 'for', 'break', 'continue', 'do', 'nobr', 'silent', 'type', 'button', 'cycle', 'listbox', 'linkappend', 'linkprepend', 'linkreplace', 'link', 'append', 'prepend', 'replace', 'createaudiogroup', 'createplaylist', 'done', 'repeat', 'stop', 'timed', 'next', 'capture', 'widget', 'script',
                             'silently', 'click', 'endsilently', 'endclick',
                             'endif', 'endfor', 'endnobr', 'endscript', 'endbutton', 'endappend', 'endprepend', 'endreplace', 'endwidget'];
        var cursor = 0;
        var stack = [];
        while(true) {
            cursor = html.indexOf('<', cursor);
            if (cursor === -1) {
                digStackForTag(stack, '', -1, 0, html, passage);
                const idx = stack.length-1;
                if (idx >= 0) {
                    return throwError(errorMsgAt('Unmatched tag at ', html, stack[idx].pos), passage);
                }
                return; // done;
            }
            cursor++;
            var next, type = 0, subtype = 0;
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
                    const tagName = html.substring(nameAt[0], nameAt[1]);
                    if (sugarMacros.indexOf(tagName) !== -1) {
                        next = tagName;
                        nextPos = cursor-2;
                        if (type != 0) {
                            nextPos--;
                            if (html.charAt(nameAt[1]) != '>' || html.charAt(nameAt[1] + 1) != '>') {
                                return throwError(errorMsgAt('Broken closing macro at ', html, nextPos), passage);
                            }
                        }
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
                    const tagName = html.substring(nameAt[0], nameAt[1]);
                    if (htmlTags.indexOf(tagName) !== -1) {
                        next = tagName;
                        nextPos = cursor-1;
                        if (type != 0) {
                            nextPos--;
                            if (html.charAt(nameAt[1]) != '>') {
                                return throwError(errorMsgAt('Broken closing tag at ', html, nextPos), passage);
                            }
                        }
                    }
                }
            }
            if (nextPos === -1) {
                continue;
            }
            // convert mid-macros
            // -- deprecated closing macros
            if (next.startsWith('end')) {
                if (type === 1) {
                    return throwError(errorMsgAt('Invalid tag at ', html, nextPos), passage);
                }
                type = 1;
                next = next.substring(3);
            }
            // -- mid macros of if statements
            if (next == 'else' || next == 'elseif') {
                if (type === 1) {
                    return throwError(errorMsgAt('Invalid tag at ', html, nextPos), passage);
                }
                type = next == 'else' ? -2 : -1;
                next = 'if';
            }
            // -- mid macros of switch statements
            if (next == 'case' || next == 'default') {
                if (type === 1) {
                    return throwError(errorMsgAt('Invalid tag at ', html, nextPos), passage);
                }
                type = next == 'default' ? -4 : -3;
                next = 'switch';
            }
            // -- mid macros of for loops
            if (next == 'break' || next == 'continue') {
                if (type === 1) {
                    return throwError(errorMsgAt('Invalid tag at ', html, nextPos), passage);
                }
                type = -5;
                next = 'for';
                subtype = 2;
            }
            // -- mid macros of timed statements
            if (next == 'next') {
                if (type === 1) {
                    return throwError(errorMsgAt('Invalid tag at ', html, nextPos), passage);
                }
                type = -6;
                next = 'timed';
                subtype = 2;
            }
            // -- mid macros of repeat statements
            if (next == 'stop') {
                if (type === 1) {
                    return throwError(errorMsgAt('Invalid tag at ', html, nextPos), passage);
                }
                type = -7;
                next = 'repeat';
                subtype = 2;
            }
            // update/check stack
            if (type == 0) {
                // standard opening tag -> add to stack
                stack.push({tag:next, type:0, tagtype:subtype, pos: nextPos});
            } else if (type < 0) {
                // special sub-opening tags ('elseif' / 'else' , 'case' / 'default')
                type = -type;
                if (!digStackForTag(stack, next, subtype, nextPos, html, passage)) {
                    const hider = hiderTag(stack, next);
                    if (hider == null) {
                        // missing if/switch/for
                        return throwError(errorMsgAt(`Missing '${next}' before `, html, nextPos), passage);
                    } else {
                        // unmatched tags between (switch|case / case|default) or (if|elseif / else|elseif) tags
                        return throwError(errorMsgAt('Mangled tag at ', html, nextPos) + errorMsgAt(', after unmatched tag at ', html, hider.pos), passage);
                    }
                }
                const idx = stack.length-1;
                if (stack[idx].type === 2 || stack[idx].type === 4) {
                    // 'else' / 'default' already found
                    if (type === 2) {
                        return throwError(errorMsgAt('Double <<else>> found inside if block at ', html, nextPos), passage);
                    } else if (type === 1) {
                        return throwError(errorMsgAt('<<elseif found after <<else>> inside if block at ', html, nextPos), passage);
                    } else if (type === 4) {
                        return throwError(errorMsgAt('Double <<default>> found inside switch block at ', html, nextPos), passage);
                    } else if (type === 3) {
                        return throwError(errorMsgAt('<<case found after <<default>> inside switch block at ', html, nextPos), passage);
                    }
                }
                stack[idx].type = type;
                stack[idx].pos = nextPos;
            } else {
                // closing tags
                if (!digStackForTag(stack, next, subtype, nextPos, html, passage)) {
                    const hider = hiderTag(stack, next);
                    if (hider == null) {
                        return throwError(errorMsgAt('Unmatched tag at ', html, nextPos), passage);
                    } else {
                        return throwError(errorMsgAt('Mangled tag at ', html, nextPos) + errorMsgAt(', after unmatched tag at ', html, hider.pos), passage);
                    }
                }
                stack.pop();
            }
            cursor = nextPos + 3;
        }
    }

    function findInvalidConditions(html, passage) {
        const matches = html.match(/<<(else)?if [^>]* is(not)? (gt|gte|lt|lte) [^>]*>>/g);
        if (matches) {
            for (const match of matches) {
                addError(`Invalid condition found: '${match}', is/isnot should not be used in combination with lt/lte/gt/gte`, passage);
            }
        }
    }

    function checkInvalidWidgets(html, passage) {
        // Find our tags
        const tags = getHTMLAttr(passage.header, 'tags');
        // If one of this passage's tags is widget, we dont need to check if there are invalid widgets, cause they'd be valid in this passage
        if (tags.split(' ').indexOf('widget') !== -1) return;
        // Determine if there are any widget tags
        const index = html.indexOf('<<widget ');
        if (index !== -1) addError(errorMsgAt('Widget without a widget tag at ', html, index), passage);
    }

    function findDeprecatedInPassage(html, passage) {
        const deprecationMap = {
            '<<click': '<<link',
            '<<endclick>>': '<</link>>',
            '<</click>>': '<</link>>',
            '<<endif>>': '<</if>>',
            '<<endnobr>>': '<</nobr>>',
            '<<endsilently>>': '<</silently>>',
            '<<endfor>>': '<</for>>',
            '<<endscript>>': '<</script>>',
            '<<endbutton>>': '<</button>>',
            '<<endappend>>': '<</append>>',
            '<<endprepend>>': '<</prepend>>',
            '<<endreplace>>': '<</replace>>',
            '<<endwidget>>': '<</widget>>',
            '<<setplaylist': '<<createplaylist',
            '<<stopallaudio>>': '<<audio ":all" stop>>',
            '<<display': '<<include',
            '<<forget': 'forget()',
            '<<remember': `memorize()' and 'recall()`,
            'state.active.variables': 'State.variables',
            'State.initPRNG(': 'State.prng.init(',
            '.containsAll(': '.includesAll(',
            '.containsAny(': '.includesAny(',
            '.flatten(': '.flat(',
        };
        const deprecationKeys = Object.keys(deprecationMap);
        for (const key of deprecationKeys) {
            const index = html.indexOf(key);
            if (index !== -1) {
                addWarning([[errorMsgAt(`Deprecated '${key}' (should be '${deprecationMap[key]}') found at `, html, index)]], passage.header);
            }
        }
    }
    
    function findDeprecatedInScript() {
        const deprecationMap = {
            'state.active.variables': 'State.variables',
            'State.initPRNG(': 'State.prng.init(',
            '.containsAll(': '.includesAll(',
            '.containsAny(': '.includesAny(',
            '.flatten(': '.flat(',
            'macros.': 'Macro.add(',
        };
        const initialIndex = fileData.indexOf('id="twine-user-script"');
        const maxIndex = fileData.indexOf('</script>', initialIndex);
        const deprecationKeys = Object.keys(deprecationMap);
        for (const key of deprecationKeys) {
            let curIndex = initialIndex;
            while(true) {
                const startIndex = fileData.indexOf(key, curIndex);
                if (startIndex === -1) break;
                if (startIndex >= maxIndex) break;
                if (key === 'macros.') { // Special case, ignore if this is not stand-alone
                    const precedingChar = fileData.substr(startIndex - 1, 1);
                    if (precedingChar.match(/[\._a-z0-9]/i)) {
                        curIndex = startIndex + key.length;
                        continue;
                    }
                }
                const endOfLineIndex = fileData.indexOf('\n', startIndex);
                const lines = fileData.substring(0, endOfLineIndex).split('\n');
                const line = lines[lines.length - 1].trim();
                if (!line.startsWith('//') && !line.startsWith('/*')) {
                    addWarning([
                        ['Line $$1: $$2', lines.length, line],
                        ["'$$1' should be '$$2'", key, deprecationMap[key]],
                    ], 'Deprecated code found in Twine User-script');
                }
                curIndex = startIndex + key.length;
            }
        }
    }

    // ['script', 'widget', 'for', 'link', 'button']
    const allMacros = {
        // Native macros
        // if: { closed: true, sub: [ 'elseif', 'else'] },
        // switch: { closed: true, sub: [ 'case', 'default'] },
        // for: { closed: true, sub: [ 'break', 'continue'] },
        // repeat: { closed: true, sub: [ 'stop' ] },
        cycle: { closed: true, sub: [ 'option', 'optionsfrom ']},
        listbox: { closed: true, sub: [ 'option', 'optionsfrom ']},
        // timed: { closed: true, sub: [ 'next' ]},
        createaudiogroup: { closed: true, sub: [ 'track' ]},
        createplaylist: { closed: true, sub: [ 'track' ]},
    };
    function addSimpleMacro(name, closed) {
        allMacros[name] = { closed };
    }
    // Closed
    // ['capture', 'do', 'done', 'script', 'nobr', 'silently', 'silent', 'type', 'button', 'link', 'linkappend', 'linkprepend', 'linkreplace', 'append', 'prepend', 'replace', 'widget'].forEach((name) => addSimpleMacro(name, true));
    // Unclosed
    ['set', 'unset', 'run', '=', '-', 'include', 'print', 'checkbox', 'radiobutton', 'textarea', 'textbox', 'numberbox', 'actions', 'back', 'choice', 'return', 'addclass'].forEach((name) => addSimpleMacro(name, false));
    ['copy', 'remove', 'removeclass', 'toggleclass', 'audio', 'cacheaudio', 'playlist', 'masteraudio', 'removeplaylist', 'waitforaudio', 'removeaudiogroup', 'redo', 'goto'].forEach((name) => addSimpleMacro(name, false));

    let failedToParseAllMacros = false;
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
        while(true) {
            index = fileData.indexOf(macroStartSyntax, index);
            if (index === -1 || index > scriptEndIndex) break;
            let cursor = index;
            while(true) {
                cursor = fileData.indexOf(')', cursor);
                if (cursor === -1 || cursor > scriptEndIndex) {
                    addWarning([[errorMsgAt(`Could not evaluate macro at `, fileData, index)]], 'user-script');
                    index++;
                    break;
                }
                cursor++;
                const macroCode = fileData.substring(index, cursor);
                const results = tryEvalMacro(macroCode);
                if (results !== false) {
                    for (const result of  results) {
                        const { name , tags } = result;
                        allMacros[name] = { closed: (tags !== undefined), sub: tags };
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
        while(true) {
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
                addWarning([[errorMsgAt(`Could not parse deprecated macro at `, fileData, index)]], 'user-script');
                index++;
                continue;
            }
            const macroName = fileData.substring(qNameAt[0], qNameAt[1]);

            let cursor = innerStartIndex;
            while(true) {
                cursor = fileData.indexOf('}', cursor);
                if (cursor === -1 || cursor > scriptEndIndex) {
                    addWarning([[errorMsgAt(`Could not evaluate deprecated macro at `, fileData, index)]], 'user-script');
                    index++;
                    break;
                }
                cursor++;
                const macroCodeObj = fileData.substring(innerStartIndex, cursor);
                const macroCode = `Macro.add('${macroName}', ${macroCodeObj})`;
                const result = tryEvalMacro(macroCode);
                if (result !== false) {
                    const { name , tags } = result;
                    allMacros[name] = { closed: (tags !== undefined), sub: tags };
                    index = cursor;
                    break;
                }
            }
        }
    }

    const allWidgets = [];
    let failedToParseAllWidgets = false;
    function findAllWidgets(html, passage) {
        // Find our tags
        const tags = getHTMLAttr(passage.header, 'tags');
        // If none of this passage's tags is widget, we dont need to check if there are any widgets
        if (tags.split(' ').indexOf('widget') === -1) return;
        // Find all widgets
        let index = 0;
        while (true) {
            // find widget macro
            index = html.indexOf('<<', index);
            if (index === -1) break;
            const defAt = index;
            index += 2;
            const nameAt = tagNameAt(html, index);
            if (nameAt[0] === nameAt[1]) {
                continue;
            }
            const tagName = html.substring(nameAt[0], nameAt[1]);
            if (tagName != 'widget') {
                continue;
            }
            index = nameAt[1];
            // parse the name
            const qNameAt = tagQNameAt(html, index);
            if (qNameAt && qNameAt[0] != qNameAt[1]) {
                const end = qNameAt[1] + (qNameAt[2] ? 1 : 0);
                if (html.charAt(end).match(/[\s>]/)) {
                    const widgetName = html.substring(qNameAt[0], qNameAt[1]);
                    if (allWidgets.indexOf(widgetName) === -1) allWidgets.push(widgetName);
                    continue;
                }
            }
            addError(errorMsgAt(`Invalid widget definition at `, html, defAt), passage);
        }
    }

    const excludeTags = ['if', 'elseif', 'else', 'switch', 'case', 'default', 'for', 'break', 'continue', 'do', 'nobr', 'silent', 'type', 'button', 'linkappend', 'linkprepend', 'linkreplace', 'link', 'append', 'prepend', 'replace', 'done', 'repeat', 'stop', 'timed', 'next', 'capture', 'widget', 'script',
        'silently', 'click', 'endsilently', 'endclick',
        'endif', 'endfor', 'endnobr', 'endscript', 'endbutton', 'endappend', 'endprepend', 'endreplace', 'endwidget', 'setplaylist', 'stopallaudio', 'display', 'remember', 'forget'];

    function findAllTags(html, passage) {
        let ignoreTagInRange = [];
        let index = 0;
        while(true) {
            index = html.indexOf('<<', index);
            if (index === -1) return;
            var nameAt = tagNameAt(html, index + 2);
            if (nameAt[0] === nameAt[1]) {
                const fc = html.charAt(nameAt[0]);
                if (fc === '/') {
                    nameAt = tagNameAt(html, nameAt[0] + 1);
                    if (nameAt[0] === nameAt[1]) {
                        return throwError(errorMsgAt(`Unrecognized closing at `, html, index), passage);
                    }
                    const tagName = html.substring(nameAt[0], nameAt[1]);
                    if (excludeTags.indexOf(tagName) === -1) {
                        const isMacro = allMacros[tagName];
                        if (!isMacro) {
                            return throwError(errorMsgAt(`Unrecognized macro close at `, html, index), passage);
                        }
                        if (!isMacro.closed) {
                            return throwError(errorMsgAt(`Macro should not be closed, but was at `, html, index), passage);
                        }
                    }
                } else if (fc !== '-' && fc !== '=') {
                    return throwError(errorMsgAt(`Invalid macro at `, html, index), passage);
                }
            } else {
                const tagName = html.substring(nameAt[0], nameAt[1]);
                if (excludeTags.indexOf(tagName) === -1 && !ignoreTagInRange.some((item) => item.tag === tagName && index > item.range[0] && index < item.range[1])) {
                    if (allWidgets.indexOf(tagName) === -1) {
                        const isMacro = allMacros[tagName];
                        if (!isMacro) {
                            return throwError(errorMsgAt(`Unrecognized macro at `, html, index), passage);
                        }
                        if (isMacro.closed) {
                            const closeTagIndex = html.indexOf('<</' + tagName + '>>', index + 2);
                            if (closeTagIndex === -1) {
                                return throwError(errorMsgAt(`Macro should be closed, but was not at `, html, index), passage);
                            }
                            if (isMacro.sub) {
                                for (const subtag of isMacro.sub) {
                                    ignoreTagInRange.push({ tag: subtag, range: [index, closeTagIndex] });
                                }
                            }
                        }
                    }
                }
            }
            index += 2;
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
            checkInvalidWidgets(passage.content, passage);
            findAllTags(passage.content, passage);
        } catch(e) {
            if (e.message != 'Error' && e.stack) {
                addError('Unhandled Exception: ' + e.stack, passage);
            }
        }
    }
    findDeprecatedInScript();

    return {
        failedToParseAllMacros,
        failedToParseAllWidgets,
        errors: validationErrors,
        warnings: validationWarnings,
    };
}

if (typeof module !== 'undefined') module.exports = validate;
