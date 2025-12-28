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
        ['"""', '"""', 'Markup escape'],
        ['<nowiki>', '</nowiki>', 'Markup escape'],
        ['{{{', '}}}', 'Markup escape'],
        ['/*', '*/', 'Markup escape'],
        ['/%', '%/', 'Markup escape'],
        ['<!--', '-->', 'Markup escape'],
        ['<<script>>', '<</script>>', 'Script']
    ];
    function recodeExcludedHTML(html, header) {
        let startIndex = 0;
        while(true) {
            let firstIndex = html.length;
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
                addWarning([
                    [`Found $$1 opening '$$2', but no subsequent closing '$$3'`, firstMarkup[2], firstMarkup[0], firstMarkup[1]],
                ], header);
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
    const passageNameIndex = {};
    const passageIdIndex = {};
    let lastIndex = 0;
    while(true) {
        const startIndex = fileData.indexOf(passageStartTag, lastIndex);
        if (startIndex === -1) break;
        const endIndex = fileData.indexOf(passageCloseTag, startIndex);
        if (endIndex === -1) throw 'Unclosed passage found: ' + fileData.substr(startIndex, 200);
        const contentIndex = fileData.indexOf('>', startIndex) + 1;
        const header = fileData.substring(startIndex, contentIndex);
        const content = recodeExcludedHTML(decodeHTML(fileData.substring(contentIndex, endIndex)), header);
        const id = getHTMLAttr(header, 'pid');
        const name = getHTMLAttr(header, 'name');
        const passage = { header, content, id, name };
    
        // Add stuff
        passages.push(passage);
        if (name) passageNameIndex[name] = passage;
        if (id) passageIdIndex[id] = passage;
        lastIndex = endIndex + passageCloseTag.length;
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
        const numSingleQuotes = html.split("'").length - 1;
        const unevenDoubleQuotes = (numDoubleQuotes % 2) === 1;
        const unevenSingleQuotes = (numSingleQuotes % 2) === 1; // single quotes can reasonably be used in plain english
        if (unevenDoubleQuotes) addWarning([['Uneven number of double-quotes in passage']], passage.header);
        // if (unevenSingleQuotes) addWarning([['Uneven number of single-quotes in']], passage.header);
    }
    
    function matchGTLT(html, passage) {
        let htmlClone = html;
        while(true) {
            const start = htmlClone.lastIndexOf('<<');
            const end = htmlClone.indexOf('>>', start);
            if (start === -1 && end === -1) return;
            if (start === -1 || end === -1) {
                if (start !== -1) {
                    const lineend = html.indexOf('\n', start);
                    const linestart = html.substr(0, lineend).lastIndexOf('\n');
                    const line = html.substring(linestart, lineend).trim().substr(0, 160);
                    return throwError(`Found an opening '<<' without matching '>>' Line: ${line}`, passage);
                } else {
                    const lineend = html.indexOf('\n', end);
                    const linestart = html.substr(0, lineend).lastIndexOf('\n');
                    const line = html.substring(linestart, lineend).trim().substr(0, 160);
                    return throwError(`Found a closing '>>' without matching '<<' Line: ${line}`, passage);
                }
            }
            htmlClone = htmlClone.substr(0, start) + '{{' + htmlClone.substring(start + 2, end) + '}}' + htmlClone.substr(end + 2);
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
                if (last.tag != tag || last.tagtype != subtype) {
                    addWarning([['Unmatched tag at ' + html.substring(pos, pos + 40)]], passage.header);
                } else {
                    fake = 0;
                }
            }
            if (fake) {
                stack.push({});
            }
            return true;
        }
        while (stack.length != 0) {
            const last = stack[stack.length-1];
            if (last.tag != tag || last.tagtype != subtype) {
                if (last.tagtype != 0) {
                    addWarning([['Unmatched tag at ' + html.substring(last.pos, last.pos + 40)]], passage.header);
                    stack.pop();
                    continue;
                }
                break;
            }
            return true;
        }
        return false;
    }

    function matchTags(html, passage) {
        const htmlTags = ['div', 'b', 'strong', 'strike', 'u', 'i', 'li', 'ul', 'h1', 'h2', 'h3', 'p', 'table', 'tbody', 'th', 'tr', 'td', 'label', 'span', 'a', 'link', 'button', 'center'];
        const sugarMacros = ['if', 'elseif', 'else', 'switch', 'case', 'default', 'for', 'do', 'nobr', 'silent', 'type', 'button', 'cycle', 'linkappend', 'linkprepend', 'linkreplace', 'link', 'listbox', 'append', 'prepend', 'replace', 'createaudiogroup', 'createplaylist', 'done', 'repeat', 'timed', 'widget', 'script',
                             'silently', 'click', 'endsilently', 'endclick',
                             'endif', 'endnobr','endfor', 'endscript', 'endbutton', 'endappend', 'endprepend', 'endreplace', 'endwidget'];
        var cursor = 0;
        var stack = [];
        while(true) {
            cursor = html.indexOf('<', cursor);
            if (cursor === -1) {
                digStackForTag(stack, '', -1, 0, html, passage);
                const idx = stack.length-1;
                if (idx >= 0) {
                    return throwError('Unmatched tag at ' + html.substring(stack[idx].pos, stack[idx].pos + 40), passage);
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
                const current = html.substring(cursor, cursor + 32);
                for (const tag of sugarMacros) {
                    if (current.startsWith(tag)) {
                        const nextChar = current.charAt(tag.length);
                        if (nextChar.match(/[^\w-]/)) {
                            next = tag;
                            nextPos = cursor-2;
                            if (type != 0) {
                                nextPos--;
                                if (nextChar != '>' || current.charAt(tag.length + 1) != '>') {
                                    return throwError('Broken closing macro at ' + html.substring(nextPos, nextPos + 40), passage);
                                }
                            }
                            break;
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
                const current = html.substring(cursor, cursor + 32);
                for (const tag of htmlTags) {
                    if (current.startsWith(tag)) {
                        const nextChar = current.charAt(tag.length);
                        if (nextChar.match(/[^\w-]/)) {
                            next = tag;
                            nextPos = cursor-1;
                            if (type != 0) {
                                nextPos--;
                                if (nextChar != '>') {
                                    return throwError('Broken closing tag at ' + html.substring(nextPos, nextPos + 40), passage);
                                }
                            }
                            break;
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
                    return throwError('Invalid tag at ' + html.substring(nextPos, nextPos + 40), passage);
                }
                type = 1;
                next = next.substring(3);
            }
            // -- mid macros of if statements
            if (next == 'else' || next == 'elseif') {
                if (type === 1) {
                    return throwError('Invalid tag at ' + html.substring(nextPos, nextPos + 40), passage);
                }
                type = next == 'else' ? -2 : -1;
                next = 'if';
            }
            // -- mid macros of switch statements
            if (next == 'case' || next == 'default') {
                if (type === 1) {
                    return throwError('Invalid tag at ' + html.substring(nextPos, nextPos + 40), passage);
                }
                type = next == 'default' ? -4 : -3;
                next = 'switch';
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
                        if (type <= 2) {
                            // missing 'if'-branch
                            return throwError('Missing if-branch before ' + html.substring(nextPos, nextPos + 40), passage);
                        } else {
                            // missing 'switch'-branch
                            return throwError('Missing switch-branch before ' + html.substring(nextPos, nextPos + 40), passage);
                        }
                    } else {
                        // unmatched tags between (switch|case / case|default) or (if|elseif / else|elseif) tags
                        return throwError('Mangled tag at ' + html.substring(nextPos, nextPos + 40) + ', after unmatched tag at ' + html.substring(hider.pos, hider.pos + 40), passage);
                    }
                }
                const idx = stack.length-1;
                if (stack[idx].type === 2 || stack[idx].type === 4) {
                    // 'else' / 'default' already found
                    if (type === 2) {
                        return throwError('Double <<else>> found inside if block at ' + html.substring(nextPos, nextPos + 40), passage);
                    } else if (type === 1) {
                        return throwError('<<elseif found after <<else>> inside if block at ' + html.substring(nextPos, nextPos + 40), passage);
                    } else if (type === 4) {
                        return throwError('Double <<default>> found inside switch block at ' + html.substring(nextPos, nextPos + 40), passage);
                    } else if (type === 3) {
                        return throwError('<<case found after <<default>> inside switch block at ' + html.substring(nextPos, nextPos + 40), passage);
                    }
                }
                stack[idx].type = type;
                stack[idx].pos = nextPos;
            } else {
                // closing tags
                if (!digStackForTag(stack, next, subtype, nextPos, html, passage)) {
                    const hider = hiderTag(stack, next);
                    if (hider == null) {
                        return throwError('Unmatched tag at ' + html.substring(nextPos, nextPos + 40), passage);
                    } else {
                        return throwError('Mangled tag at ' + html.substring(nextPos, nextPos + 40) + ', after unmatched tag at ' + html.substring(hider.pos, hider.pos + 40), passage);
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
        if (html.indexOf('<<widget ') !== -1) addError('<<widget found in passage without a widget tag', passage);
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
            if (html.indexOf(key) !== -1) {
                addWarning([[`Deprecated markup found in passage ('$$1' should be '$$2')`, key, deprecationMap[key]]], passage.header);
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
        switch: { closed: true, sub: [ 'case', 'default'] },
        for: { closed: true, sub: [ 'break', 'continue'] },
        repeat: { closed: true, sub: [ 'stop' ] },
        cycle: { closed: true, sub: [ 'option', 'optionsfrom ']},
        listbox: { closed: true, sub: [ 'option', 'optionsfrom ']},
        timed: { closed: true, sub: [ 'next' ]},
        createaudiogroup: { closed: true, sub: [ 'track' ]},
        createplaylist: { closed: true, sub: [ 'track' ]},
    };
    function addSimpleMacro(name, closed) {
        allMacros[name] = { closed, sub: closed ? [] : undefined };
    }
    // Closed
    ['capture', 'script', 'nobr', 'silently', 'button', 'link', 'linkappend', 'linkprepend', 'linkreplace', 'append', 'prepend', 'replace', 'widget'].forEach((name) => addSimpleMacro(name, true));
    // Unclosed
    ['set', 'unset', 'run', '=', '-', 'include', 'print', 'checkbox', 'radiobutton', 'textarea', 'textbox', 'actions', 'back', 'choice', 'return', 'addclass'].forEach((name) => addSimpleMacro(name, false));
    ['copy', 'remove', 'removeclass', 'toggleclass', 'audio', 'cacheaudio', 'playlist', 'masteraudio', 'removeplaylist', 'waitforaudio', 'goto'].forEach((name) => addSimpleMacro(name, false));

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
        const userscript = fileData.substring(scriptStartIndex, scriptEndIndex);
        const macroStartSyntax = 'Macro.add(';
        let startIndex = 0;
        while(true) {
            const index = userscript.indexOf(macroStartSyntax, startIndex);
            if (index === -1) return;
            let innerStartIndex = startIndex = index + macroStartSyntax.length;
            let attempt = 0;
            while(true) {
                const possibleEndIndex = userscript.indexOf(')', innerStartIndex);
                const macroCode = userscript.substring(index, possibleEndIndex + 1);
                const results = tryEvalMacro(macroCode);
                if (results !== false) {
                    for (const result of  results) {
                        const { name , tags } = result;
                        allMacros[name] = { closed: (typeof tags !== 'undefined'), sub: tags };
                    }
                    startIndex = possibleEndIndex + 1;
                    break;
                } else {
                    innerStartIndex = possibleEndIndex + 1;
                    if (attempt++ > 100) {
                        failedToParseAllMacros = true;
                        break;
                    }
                }
            }
        }
    }

    function findAllCustomMacrosDeprecated() {
        const scriptStartIndex = fileData.indexOf('id="twine-user-script"');
        if (scriptStartIndex === -1) return;
        const scriptEndIndex = fileData.indexOf('</script>', scriptStartIndex);
        if (scriptEndIndex === -1) return;
        let userscript = fileData.substring(scriptStartIndex, scriptEndIndex);
        while(true) {
            const match = userscript.match(/macros\s*\.([a-zA-Z][a-zA-Z0-9_]*)\s*=\s*{/);
            if (!match) break;
            
            const fullStr = match[0];
            const macroName = match[1];
            const innerStartIndex = match.index + fullStr.length - 1;
            let innerEndIndexMinBound = innerStartIndex;
            let attempt = 0;
            while(true) {
                const possibleEndIndex = userscript.indexOf('}', innerEndIndexMinBound);
                const macroCodeObj = userscript.substring(innerStartIndex, possibleEndIndex + 1);
                const macroCode = `Macro.add('${macroName}', ${macroCodeObj})`;
                const result = tryEvalMacro(macroCode);
                if (result !== false) {
                    const { name , tags } = result;
                    allMacros[name] = { closed: (typeof tags !== 'undefined'), sub: tags };
                    userscript = userscript.substr(innerStartIndex);
                    break;
                } else {
                    innerEndIndexMinBound = possibleEndIndex + 1;
                    if (attempt++ > 100) {
                        userscript = userscript.substr(innerStartIndex);
                        failedToParseAllMacros = true;
                        console.error('Could not find custom macro', macroName, macroCode);
                        break;
                    }
                }
            }
        }

        userscript = fileData.substring(scriptStartIndex, scriptEndIndex);
        while(true) {
            const match = userscript.match(/macros\s*\[['"]([a-zA-Z][a-zA-Z0-9_]*)["']\]\s*=\s*{/);
            if (!match) break;
            
            const fullStr = match[0];
            const macroName = match[1];
            const innerStartIndex = match.index + fullStr.length - 1;
            let innerEndIndexMinBound = innerStartIndex;
            let attempt = 0;
            while(true) {
                const possibleEndIndex = userscript.indexOf('}', innerEndIndexMinBound);
                const macroCodeObj = userscript.substring(innerStartIndex, possibleEndIndex + 1);
                const macroCode = `Macro.add('${macroName}', ${macroCodeObj})`;
                const result = tryEvalMacro(macroCode);
                if (result !== false) {
                    const { name , tags } = result;
                    allMacros[name] = { closed: (typeof tags !== 'undefined'), sub: tags };
                    userscript = userscript.substr(innerStartIndex);
                    break;
                } else {
                    innerEndIndexMinBound = possibleEndIndex + 1;
                    if (attempt++ > 100) {
                        userscript = userscript.substr(innerStartIndex);
                        failedToParseAllMacros = true;
                        console.error('Could not find custom macro', macroName, macroCode);
                        break;
                    }
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
        let startIndex = 0;
        while (true) {
            const find = '<<widget ';
            const index = html.indexOf(find, startIndex);
            if (index === -1) return;
            let widgetName = html.substr(index + find.length).trim().split(' ').shift().split('>').shift().split('\n').shift();
            if (widgetName[0] === '"' && widgetName[widgetName.length - 1] === '"') widgetName = widgetName.substring(1, widgetName.length - 1);
            else if (widgetName[0] === '$') failedToParseAllWidgets = true;
            if (allWidgets.indexOf(widgetName) === -1) allWidgets.push(widgetName);
            startIndex = index + find.length + widgetName.length;
        }
    }

    const excludeTags = ['if', 'else', 'elseif', 'endif', 'click', 'endclick', 'endnobr', 'endsilently', 'endfor', 'endscript', 'endbutton', 'endappend', 'endprepend', 'endreplace', 'endwidget', 'setplaylist', 'stopallaudio', 'display', 'remember', 'forget'];
    const excludePrefix = ['/', '-', '='];
    function findAllTags(html, passage) {
        let ignoreTagInRange = [];
        let startIndex = 0;
        while(true) {
            const index = html.indexOf('<<', startIndex);
            if (index === -1) return;
            const tagName = html.substr(index + 2).split(/[\s\("'\[!]/).shift().split('>').shift().split('\n').shift();
            if (excludePrefix.indexOf(tagName[0]) === -1 && excludeTags.indexOf(tagName) === -1) {
                if (tagName[0] === '$' || tagName[0] === '_') {
                    return throwError(`Found '<<${tagName}'. Though this doesn't cause errors directly in the game, something else was almost certainly intended (ie: '<<=${tagname}')`, passage);
                }
                else if (!ignoreTagInRange.some((item) => item.tag === tagname && index > item.range[0] && index < item.range[1])) {
                    const closeTagIndex = html.substr(index).indexOf('<</' + tagName + '>>');
                    const isClosed = closeTagIndex !== -1;
                    const isWidget = allWidgets.indexOf(tagName) !== -1;
                    const isMacro = allMacros[tagName];
                    if (!isMacro && !isWidget) {
                        return throwError(`<<${tagName} found, but could not find macro or widget definition for tagname`, passage);
                    } else {
                        const shouldBeClosed = isWidget ? false : (isMacro && isMacro.closed);
                        if (isMacro && isMacro.sub && isMacro.sub.length) {
                            for (const subtag of isMacro.sub) {
                                ignoreTagInRange.push({ tag: subtag, range: [index, closeTagIndex] });
                            }
                        }
                        if (isClosed !== shouldBeClosed) {
                            if (isClosed) return throwError(`Macro '${tagName}' should not be closed, but was`, passage);
                            if (shouldBeClosed) return throwError(`Macro '${tagName}' should be closed, but was not`, passage);
                        }
                    }
                }
            }
            startIndex = index + tagName.length + 1;
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
