function validate(fileData, localStorage = {}) {
    const validationErrors = {};
    const validationWarnings = {}

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

    const exclusionMarkup = [
        ['"""', '"""'], // Markup escape
        ['<nowiki>', '</nowiki>'],
        ['{{{', '}}}'],
        ['/*', '*/'],
        ['/%', '%/'],
        ['<!--', '-->'],
        ['<<script>>', '<</script>>'] // script
    ];
    function parsePassage(html, startIndex, contentIndex, endIndex) {
        const header = html.substring(startIndex, contentIndex);
        var content = decodeHTML(html.substring(contentIndex, endIndex));
        let cursor = 0;
        while(true) {
            let firstIndex = Infinity;
            let firstMarkup = null;
            for (const markup of exclusionMarkup) {
                const index = content.indexOf(markup[0], cursor);
                if (index !== -1 && index < firstIndex) {
                    firstIndex = index;
                    firstMarkup = markup;
                }
            }
            // If none of the opening markup can be found, we're done
            if (!firstMarkup) {
                break;
            }
            // If something is found, find the matching closing markup
            const closingIndex = content.indexOf(firstMarkup[1], firstIndex + firstMarkup[0].length);
            // If no closing markup is found, add a warning and stop trying to exclude further markup
            if (closingIndex === -1) {
                addWarning([[errorMsgAt(`Found opening '${firstMarkup[0]}' without closing '${firstMarkup[1]}' at `, content, firstIndex)]], header);
                break;
            }
            // modify html to re-encode the excluded markup
            content = content.substr(0, firstIndex + firstMarkup[0].length) + recodeHTML(content.substring(firstIndex + firstMarkup[0].length, closingIndex)) + content.substr(closingIndex);
            cursor = closingIndex + firstMarkup[1].length;
        }
        //const id = getHTMLAttr(header, 'pid');
        //const name = getHTMLAttr(header, 'name');
        return { header, content }; //, id, name };
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
    let lastIndex = 0;
    while(true) {
        const startIndex = fileData.indexOf(passageStartTag, lastIndex);
        if (startIndex === -1) break;
        const endIndex = fileData.indexOf(passageCloseTag, startIndex);
        if (endIndex === -1) throw 'Unclosed passage found: ' + fileData.substr(startIndex, 200);
        const contentIndex = fileData.indexOf('>', startIndex) + 1;
        const passage = parsePassage(fileData, startIndex, contentIndex, endIndex);
        // Add stuff
        passages.push(passage);
        lastIndex = endIndex + 16; //passageCloseTag.length;
    }
    function errorMsgAt(prefix, html, pos) {
        return prefix + html.substring(pos, pos + 80);
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
            var index1 = stack.length;
            if (index1 != 0) {
                const last = stack[index1-1];
                if (last.tag != tag || last.tagtype != 1) {
                    addWarning([[errorMsgAt('Unmatched tag at ', html, pos)]], passage.header);
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
                            addWarning([[errorMsgAt('Passage ended with an unmatched tag  at ', html, last.pos)]], passage.header);
                        } else {
                            addWarning([[errorMsgAt('Closing unmatched tag ', html, last.pos) + errorMsgAt(' before ', html, pos)]], passage.header);
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

    const htmlTags = new Set(['div', 'b', 'strong', 'strike', 'u', 'i', 'li', 'ul', 'h1', 'h2', 'h3', 'p', 'table', 'tbody', 'th', 'tr', 'td', 'label', 'span', 'a', 'link', 'button', 'center']);

    function matchTags(html, passage) {
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
                    const tagName = html.substring(nameAt[0], nameAt[1]);
                    next = tagName;
                    nextPos = cursor-2;
                    if (type != 0) {
                        nextPos--;
                        if (html.charAt(nameAt[1]) != '>' || html.charAt(nameAt[1] + 1) != '>') {
                            return throwError(errorMsgAt('Broken closing macro at ', html, nextPos), passage);
                        }
                    }
                    isMacro = allMacros[next];
                    if (!isMacro) {
                        return throwError(errorMsgAt(type == 0 ? `Unrecognized macro at ` : `Unrecognized macro close at `, html, nextPos), passage);
                    }
                    if (!isMacro.closed) {
                        if (type != 0) {
                            return throwError(errorMsgAt(`Macro should not be closed, but was at `, html, nextPos), passage);
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
                                    const pidx = digStackForTag(stack, pc.main, 2, nextPos, 0, 0);
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
                                        addWarning([[errorMsgAt(`Skipping order check of `, html, index)]], passage.header);
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
                    return throwError(errorMsgAt(`Unrecognized closing at `, html, cursor - 3), passage);
                } else {
                    const fc = html.charAt(nameAt[0]);
                    if (fc !== '-' && fc !== '=') {
                        return throwError(errorMsgAt(`Invalid macro at `, html, cursor - 2), passage);
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
                    if (htmlTags.has(tagName)) {
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
                if (subtype == 0) {
                    const idx = stack.length-1;
                    if (stack[idx].type === 2) {
                        // 'else' / 'default' already found
                        return throwError(errorMsgAt('Branch already in its last stage at ', html, nextPos), passage);
                    }
                    stack[idx].type = type;
                    stack[idx].pos = nextPos;
                }
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
        const pc = /<<[^>]*([^<]<[^<]|[^>=]>[^>])[^>]*>>/g;
        matches = html.match(pc);
        if (matches) {
            for (const match of matches) {
                if (match.match(/[^^]<</)) continue;
                const expr = replaceText(match);
                if (!expr.match(pc)) continue;
                addWarning([[`Non-standard condition found: '${match}'. Use [lte|lt|gte|gt] instead?`]], passage.header);
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
                addWarning([[errorMsgAt(`Empty assignment at `, html, index)]], passage.header);
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
                addWarning([[errorMsgAt(msg, html, index)]], passage.header);
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
                        if (sugarMacros.has(name)) addWarning([[errorMsgAt(`Custom macro conflict at `, fileData, index)]], 'user-script');
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
                    if (sugarMacros.has(name)) addWarning([[errorMsgAt(`Deprecated macro conflict at `, fileData, index)]], 'user-script');
                    else if (tags && tags.length) addComplexMacro(name, tags, 0);
                    else addSimpleMacro(name, tags !== undefined);
                    index = cursor;
                    break;
                }
            }
        }
    }

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
                    if (sugarMacros.has(widgetName)) addError(errorMsgAt(`Widget/macro '${widgetName}' redefinition at `, html, defAt), passage);
                    else addSimpleMacro(widgetName, 0);
                    index = end;
                    continue;
                }
            }
            addError(errorMsgAt(`Invalid widget definition at `, html, defAt), passage);
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
            checkInvalidWidgets(passage.content, passage);
        } catch(e) {
            if (e.message != 'Error' && e.stack) {
                addError('Unhandled Exception: ' + e.stack, passage);
            }
        }
    }
    findDeprecatedInScript();

    return {
        errors: validationErrors,
        warnings: validationWarnings,
    };
}

if (typeof module !== 'undefined') module.exports = validate;
