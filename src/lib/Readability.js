/*
 * Copyright (c) 2010 Arc90 Inc
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/*
 * This code is a direct port of the Readability library by Arc90
 * See original code here: https://github.com/arc90/readability
 */

var Readability = function(doc, options) {
  options = options || {};

  this._doc = doc;
  this._docJSDOM = null;
  this._articleTitle = null;
  this._articleByline = null;
  this._articleDir = null;
  this._articleSiteName = null;
  this._attempts = [];

  // Readability options
  this._debug = !!options.debug;
  this._maxElemsToParse = options.maxElemsToParse || this.DEFAULT_MAX_ELEMS_TO_PARSE;
  this._nbTopCandidates = options.nbTopCandidates || this.DEFAULT_N_TOP_CANDIDATES;
  this._charThreshold = options.charThreshold || this.DEFAULT_CHAR_THRESHOLD;
  this._classesToPreserve = this.CLASSES_TO_PRESERVE.concat(options.classesToPreserve || []);
  this._keepClasses = !!options.keepClasses;
  this._serializer = options.serializer || function(el) {
    return el.innerHTML;
  };

  this._log = function() {};
  if (this._debug) {
    var log = function() {
      if (typeof console !== "undefined") {
        console.log.apply(console, arguments);
      } else if (typeof dump !== "undefined") {
        // For Firefox extensions
        dump("Readability: " + Array.prototype.join.call(arguments, " ") + "\n");
      }
    };
    this._log = log;
  }

  // Start with all flags set to false.
  this._flags = this.FLAG_STRIP_UNLIKELYS;

  var unlikelyRoles = [
    "menu", "menubar", "toolbar", "sidebar", "form", "search", "tabs",
    "combobox", "listbox",
  ];
  if (this._doc.querySelector(unlikelyRoles.map(function(r) { return "[role='" + r + "']"; }).join(","))) {
    this._flags |= this.FLAG_STRIP_UNLIKELYS;
  }
  if (this._doc.querySelector("meta[name='generator'][content*='wordpress']")) {
    this._flags |= this.FLAG_WEIGHT_CLASSES;
  }

  this._parse();
};

Readability.prototype = {
  FLAG_STRIP_UNLIKELYS: 0x1,
  FLAG_WEIGHT_CLASSES: 0x2,
  FLAG_CLEAN_CONDITIONALLY: 0x4,

  // Max number of nodes supported by this parser. Default: 0 (no limit)
  DEFAULT_MAX_ELEMS_TO_PARSE: 0,

  // The number of top candidates to consider when analysing how tight the competition
  // is among candidates.
  DEFAULT_N_TOP_CANDIDATES: 5,

  // The default number of characters an article must have in order to return a result
  DEFAULT_CHAR_THRESHOLD: 500,

  // All of the regular expressions in use within readability.
  // Defined up here so we don't instantiate them repeatedly in loops.
  REGEXPS: {
    // NOTE: These two regular expressions are duplicated from
    // Readability.js. We should import them from that file.
    unlikelyCandidates: /-ad-|ai2html|banner|breadcrumbs|combx|comment|community|cover-wrap|disqus|extra|foot|header|heroes|menu|nav|pag(er|ination)|popup|promo|related|scroll|share|shoutbox|sidebar|skyscraper|sponsor|shopping|tags|tool|widget/i,
    okMaybeItsACandidate: /and|article|body|column|content|main|shadow/i,
  },

  UNLIKELY_ROLES: /menu|menubar|complementary|navigation|alert|alertdialog|dialog/,

  DIV_TO_P_ELEMS: [ "BLOCKQUOTE", "DL", "DIV", "IMG", "OL", "P", "PRE", "TABLE", "UL" ],

  ALTER_TO_DIV_EXCEPTIONS: ["DIV", "ARTICLE", "SECTION", "P"],

  PRESENTATIONAL_ATTRIBUTES: [ "align", "background", "bgcolor", "border", "cellpadding", "cellspacing", "frame", "hspace", "rules", "style", "valign", "vspace" ],

  DEPRECATED_SIZE_ATTRIBUTE_ELEMS: [ "TABLE", "TH", "TD", "HR", "PRE" ],

  // The classes that readability sets up on the HTML node.
  CLASSES_TO_PRESERVE: [ "page" ],

  // These are the classes that are used by pages for layout, and should be removed.
  LAYOUT_CLASSES: ["art-postcontent", "column-content", "hentry", "entry-content", "post-entry", "post-content", "blog-content", "story-content"],

  /**
   * Run any post-process modifications to article content as a final pass.
   *
   * @param Element
   * @return void
  **/
  _postProcessContent: function(articleContent) {
    this._fixImageFloats(articleContent);
    this._removeLayoutClasses(articleContent);
  },

  _fixImageFloats: function(articleContent) {
    var image;
    var images = articleContent.getElementsByTagName("img");
    for (var i = 0; i < images.length; i++) {
      image = images[i];
      if (image.className.indexOf("size-") !== -1 &&
          (image.style.cssFloat === "left" || image.style.cssFloat === "right")) {
        image.style.cssFloat = "none";
      }
    }
  },

  _removeLayoutClasses: function(articleContent) {
    for (var i = 0; i < this.LAYOUT_CLASSES.length; i++) {
      var layoutClass = this.LAYOUT_CLASSES[i];
      var elems = articleContent.getElementsByClassName(layoutClass);
      for (var j = 0; j < elems.length; j++) {
        elems[j].className = elems[j].className.replace(layoutClass, "");
      }
    }
  },

  /**
   * Get the article title as a string.
   *
   * @return string
   **/
  _getArticleTitle: function() {
    var doc = this._doc;
    var curTitle = "";
    var origTitle = "";

    try {
      curTitle = origTitle = doc.title;

      // If they had an element with id "title" in their page
      if (typeof curTitle !== "string") {
        curTitle = origTitle = this._getInnerText(doc.getElementsByTagName("title")[0]);
      }
    } catch (e) {
      /* ignore */
    }

    var titleHadHierarchicalSeparators = false;
    function wordCount(str) {
      return str.split(/\s+/).length;
    }

    // If there's a separator in the title, first check whether the separator is used
    // as a hierarchical separator, splitting the site name from the page title.
    // Examples: "Site Name | Page Title", "Page Title - Site Name", etc.
    if (curTitle.match(/ [\\|/•–—] /)) {
      titleHadHierarchicalSeparators = true;
      curTitle = origTitle.replace(/(.*)[ \\|/•–—] .*/gi, "$1");

      // If the resulting title is too short (3 words or fewer), remove
      // the first part instead:
      if (wordCount(curTitle) < 3) {
        curTitle = origTitle.replace(/[^\\|/•–—]*[\\|/•–—] /gi, "");
      }
    } else if (curTitle.indexOf(": ") !== -1) {
      // Check if we have an heading containing this exact string, so we
      // could assume it's the full title.
      var headings = this._concatNodeLists(
        doc.getElementsByTagName("h1"),
        doc.getElementsByTagName("h2")
      );
      var trimmedTitle = curTitle.trim();
      var matchingHeading = this._findMatchingHeading(headings, trimmedTitle);
      if (matchingHeading) {
        curTitle = trimmedTitle;
      }
    } else if (curTitle.length > 150) {
      // Check if we have an heading containing a part of the title, using
      // the first 150 characters, and if so, we assume it's the full title
      var headings = this._concatNodeLists(
        doc.getElementsByTagName("h1"),
        doc.getElementsByTagName("h2")
      );
      var trimmedTitle = curTitle.substring(0, 150).trim();
      var matchingHeading = this._findMatchingHeading(headings, trimmedTitle);
      if (matchingHeading) {
        curTitle = this._getInnerText(matchingHeading);
      }
    }

    curTitle = curTitle.trim();
    // If we now have 4 words or fewer as our title, and either no
    // hierarchical separator was found, or we decreased the number of words significantly,
    // let's try to use the first H1 tag instead:
    var curTitleWordCount = wordCount(curTitle);
    if (curTitleWordCount <= 4 &&
        (!titleHadHierarchicalSeparators ||
         curTitleWordCount !== wordCount(origTitle.replace(/[\\|/•–—].*$/, "")))) {
      var h1s = doc.getElementsByTagName("h1");

      if (h1s.length > 0) {
        var h1_text = this._getInnerText(h1s[0]);
        if (wordCount(h1_text) > curTitleWordCount)
          curTitle = h1_text;
      }
    }

    return curTitle;
  },

  /**
   * Finds a heading that matches the string passed in.
   *
   * @param {NodeList} headings
   * @param {string} string
   * @return {Node | null}
   */
  _findMatchingHeading: function(headings, string) {
    for (var i = 0; i < headings.length; i++) {
      var heading = headings[i];
      var headingText = this._getInnerText(heading);
      if (headingText === string) {
        return heading;
      }
    }
    return null;
  },

  /**
   * Prepare the HTML document for readability to scrape it.
   * This includes things like stripping javascript, CSS, and handling terrible markup.
   *
   * @return void
   **/
  _prepDocument: function() {
    var doc = this._doc;

    // Remove all style tags in head
    this._removeNodes(doc.getElementsByTagName("style"));

    if (doc.body) {
      this._replaceBrs(doc.body);
    }

    this._replaceNodeTags(doc.getElementsByTagName("font"), "SPAN");
  },

  /**
   * Finds the next node, starting from the given node, and ignoring
   * whitespace in between. If the given node is an element, the same node is
   * returned.
   */
  _nextElement: function(node) {
    var next = node;
    while (next
           && (next.nodeType !== this.NODE_TYPES.ELEMENT_NODE)
           && this.REGEXPS.whitespace.test(next.textContent)) {
      next = next.nextSibling;
    }
    return next;
  },

  /**
   * Replaces 2 or more successive <br> elements with a single <p> so that
   * they're handled properly by the scoring algorithm.
   *
   * @param Element
   * @return void
   */
  _replaceBrs: function(elem) {
    var brs = elem.getElementsByTagName("br");
    var br, next;

    // We're going backwards because we're replacing the <br> elements with
    // <p>s, and we don't want to disrupt the flow of the loop.
    for (var i = brs.length - 1; i > 0; i--) {
      br = brs[i];
      next = br.nextSibling;

      // If we've already replaced this, or the next sibling is a <br> element,
      // skip it.
      if (!next || next.tagName === "BR") {
        continue;
      }

      var nextElem = this._nextElement(next);
      if (nextElem && nextElem.tagName === "P") {
        continue;
      }

      // If the <br> is part of a text node with content, it's probably a soft
      // break and shouldn't be replaced.
      var brText = br.previousSibling;
      if (brText && brText.nodeType === this.NODE_TYPES.TEXT_NODE && brText.textContent.trim().length > 0) {
        continue;
      }

      var p = this._doc.createElement("p");
      br.parentNode.replaceChild(p, br);
      p.appendChild(br);
    }
  },

  /**
   * Replace all nodes of a given tag name with a new tag name.
   *
   * @param {NodeList} nodes
   * @param {string} newTagName
   * @return {NodeList}
   */
  _replaceNodeTags: function(nodes, newTagName) {
    for (var i = nodes.length - 1; i >= 0; i--) {
      var node = nodes[i];
      var replacement = this._doc.createElement(newTagName);
      while (node.firstChild) {
        replacement.appendChild(node.firstChild);
      }
      node.parentNode.replaceChild(replacement, node);
      for (var j = 0; j < node.attributes.length; j++) {
        replacement.setAttribute(node.attributes[j].name, node.attributes[j].value);
      }
    }
    return nodes;
  },

  /**
   * Iterate over a NodeList, which doesn't natively fully implement the Array
   * interface.
   *
   * For convenience, allows passing a second argument which is a NodeList that
   * will be appended to the first.
   *
   * @param {NodeList} node
   * @param {NodeList} anotherNode
   * @return {Array}
   */
  _concatNodeLists: function(node, anotherNode) {
    var result = [];
    if (node) {
      for (var i = 0; i < node.length; i++) {
        result.push(node[i]);
      }
    }
    if (anotherNode) {
      for (var j = 0; j < anotherNode.length; j++) {
        result.push(anotherNode[j]);
      }
    }
    return result;
  },

  /**
   * Get the inner text of a node - cross browser compatibly.
   * This also strips out any excess whitespace to be found.
   *
   * @param Element
   * @return string
  **/
  _getInnerText: function(e, normalizeSpaces) {
    normalizeSpaces = (typeof normalizeSpaces === "undefined") ? true : normalizeSpaces;
    var textContent = e.textContent.trim();

    if (normalizeSpaces) {
      return textContent.replace(/\s+/g, " ");
    }
    return textContent;
  },

  /**
   * Get the number of times a string s appears in the node e.
   *
   * @param Element
   * @param string - what to split on. Default is ","
   * @return number (integer)
  **/
  _getCharCount: function(e, s) {
    s = s || ",";
    return this._getInnerText(e).split(s).length - 1;
  },

  /**
   * Remove the style attribute on every e and under.
   * TODO: This is probably redundant to _cleanStyles and should be removed.
   *
   * @param Element
   * @return void
  **/
  _cleanStyles: function(e) {
    e = e || this._doc;
    var cur = e.firstChild;

    // If we had a bad node, there's not much we can do.
    if (!e)
      return;

    // Remove any root styles, if we're able.
    if (typeof e.removeAttribute === "function" && e.className !== "readability-styled")
      e.removeAttribute("style");

    // Go until there are no more child nodes
    while (cur) {
      if (cur.nodeType === this.NODE_TYPES.ELEMENT_NODE) {
        // Remove style attribute(s) :
        if (cur.className !== "readability-styled") {
          cur.removeAttribute("style");
        }
        this._cleanStyles(cur);
      }
      cur = cur.nextSibling;
    }
  },

  /**
   * Get the density of links as a percentage of the content
   * This is the amount of text that is inside a link divided by the total text in the node.
   *
   * @param Element
   * @return number (float)
  **/
  _getLinkDensity: function(element) {
    var textLength = this._getInnerText(element).length;
    if (textLength === 0)
      return 0;

    var linkLength = 0;
    var links = element.getElementsByTagName("a");
    for (var i = 0; i < links.length; i++) {
      linkLength += this._getInnerText(links[i]).length;
    }

    return linkLength / textLength;
  },

  /**
   * Get an elements class/id weight. Uses regular expressions to tell if this
   * element looks good or bad.
   *
   * @param Element
   * @return number (Integer)
  **/
  _getWeight: function(e) {
    if (!e) return 0;
    var weight = 0;
    var className = e.className;
    var id = e.id;

    if (className) {
      // Look for negative classes
      if (className.search(this.REGEXPS.unlikelyCandidates) !== -1)
        weight -= 25;

      // Look for positive classes
      if (className.search(this.REGEXPS.okMaybeItsACandidate) !== -1)
        weight += 25;
    }

    if (id) {
      // Look for negative ids
      if (id.search(this.REGEXPS.unlikelyCandidates) !== -1)
        weight -= 25;

      // Look for positive ids
      if (id.search(this.REGEXPS.okMaybeItsACandidate) !== -1)
        weight += 25;
    }

    return weight;
  },

  /**
   * Remove a node from the document.
   *
   * @param Element
   * @return void
   **/
  _remove: function(node) {
    if (node && node.parentNode) {
      node.parentNode.removeChild(node);
    }
  },

  /**
   * Remove an array of nodes from the document.
   *
   * @param {Array | NodeList} nodes
   * @return void
   */
  _removeNodes: function(nodes) {
    for (var i = nodes.length - 1; i >= 0; i--) {
      this._remove(nodes[i]);
    }
  },

  /**
   * Clean a node of all elements of type "tag".
   * (Unless it's a youtube/vimeo video. People love movies.)
   *
   * @param Element
   * @param string tag to clean
   * @return void
  **/
  _clean: function(e, tag) {
    var targetList = e.getElementsByTagName(tag);
    var isEmbed = (tag === "object" || tag === "embed" || tag === "iframe");

    for (var y = targetList.length - 1; y >= 0; y--) {
      // Allow youtube and vimeo videos through.
      if (isEmbed) {
        var attributeValues = "";
        for (var i = 0; i < targetList[y].attributes.length; i++) {
          attributeValues += targetList[y].attributes[i].value + "|";
        }

        // First, check the elements attributes to see if any of them contain youtube or vimeo
        if (attributeValues.search(/youtube|vimeo/i) !== -1) {
          continue;
        }

        // Then check the elements inside data tag, since some websites embed videos via url then inside data tag.
        var data = targetList[y].getElementsByTagName("data");
        if (data.length) {
          var dataAttributeValues = "";
          for (i = 0; i < data[0].attributes.length; i++) {
            dataAttributeValues += data[0].attributes[i].value + "|";
          }
          if (dataAttributeValues.search(/youtube|vimeo/i) !== -1) {
            continue;
          }
        }
      }

      this._remove(targetList[y]);
    }
  },

  /**
   * Clean an element of all tags of type "tag" if they look fishy.
   * "Fishy" is an algorithm based on content length, classnames, link density, number of images & embeds, etc.
   *
   * @param Element
   * @param string tag to clean
   * @return void
  **/
  _cleanConditionally: function(e, tag) {
    if (!(this._flags & this.FLAG_CLEAN_CONDITIONALLY))
      return;

    var tagsList = e.getElementsByTagName(tag);
    var curTagsLength = tagsList.length;

    /**
     * Gather counts for other typical elements embedded within.
     * Trailers, ads, etc.
    **/
    for (var i = curTagsLength - 1; i >= 0; i--) {
      var weight = this._getWeight(tagsList[i]);
      var contentScore = (tagsList[i].__readability) ? tagsList[i].__readability.contentScore : 0;

      this._log("Cleaning Conditionally", tagsList[i], "with weight", weight, "and content score", contentScore);

      if (weight + contentScore < 0) {
        this._remove(tagsList[i]);
      } else if (this._getCharCount(tagsList[i], ",") < 10) {
        /**
         * If there are not very many commas, and the number of
         * non-paragraph elements is more than paragraphs or other ominous signs, remove the element.
        **/
        var p = tagsList[i].getElementsByTagName("p").length;
        var img = tagsList[i].getElementsByTagName("img").length;
        var li = tagsList[i].getElementsByTagName("li").length - 100;
        var input = tagsList[i].getElementsByTagName("input").length;

        var embedCount = 0;
        var embeds = tagsList[i].getElementsByTagName("embed");
        for (var j = 0; j < embeds.length; j++) {
          if (embeds[j].src.search(this.VIDEO_REGEX) === -1) {
            embedCount++;
          }
        }

        var linkDensity = this._getLinkDensity(tagsList[i]);
        var contentLength = this._getInnerText(tagsList[i]).length;
        var toRemove = false;

        if (img > p) {
          toRemove = true;
        } else if (li > p && tag !== "ul" && tag !== "ol") {
          toRemove = true;
        } else if (input > Math.floor(p / 3)) {
          toRemove = true;
        } else if (contentLength < 25 && (img === 0 || img > 2)) {
          toRemove = true;
        } else if (weight < 25 && linkDensity > 0.2) {
          toRemove = true;
        } else if (weight >= 25 && linkDensity > 0.5) {
          toRemove = true;
        } else if ((embedCount === 1 && contentLength < 75) || embedCount > 1) {
          toRemove = true;
        }

        if (toRemove) {
          this._remove(tagsList[i]);
        }
      }
    }
  },

  /**
   * Clean out elements that match the specified regular expression.
   *
   * @param Element
   * @param RegExp
   * @return void
  **/
  _cleanMatchedNodes: function(e, regex) {
    var L = e.getElementsByTagName("*"),
        i, node;

    for (i = L.length - 1; i >= 0; i--) {
        node = L[i];

        if (regex.test(node.className + " " + node.id)) {
            this._remove(node);
        }
    }
  },

  /**
   * Clean out spurious headers from an Element.
   *
   * @param Element
   * @return void
  **/
  _cleanHeaders: function(e) {
    for (var headerIndex = 1; headerIndex < 3; headerIndex++) {
      var headers = e.getElementsByTagName("h" + headerIndex);
      for (var i = headers.length - 1; i >= 0; i--) {
        if (this._getWeight(headers[i]) < 0) {
          this._remove(headers[i]);
        }
      }
    }
  },

  _isProbablyVisible: function(node) {
    // Have to null-check node.style and node.className.
    return (!node.style || node.style.display !== "none") &&
           (!node.style || node.style.visibility !== "hidden") &&
           !node.hasAttribute("hidden") &&
           (!node.hasAttribute("aria-hidden") || node.getAttribute("aria-hidden") !== "true");
  },

  /**
   * Takes an element and looks for a sibling that has a similar score.
   *
   * @param Element
   * @return Object {
   *     content: Element,
   *     score: number
   * }
  **/
  _findArticleContainer: function(page) {
    var allElements = page.getElementsByTagName("*"),
        i, j,
        articleContainer = null,
        topCandidate = null,
        candidates = [],
        parent,
        siblingScore;

    for (i = 0, il = allElements.length; i < il; i++) {
        var el = allElements[i];

        // Remove unlikely candidates
        if (this.REGEXPS.unlikelyCandidates.test(el.className) &&
            !this.REGEXPS.okMaybeItsACandidate.test(el.className)) {
            this._remove(el);
            i--;
            il--;
            continue;
        }

        if(el.tagName === "P" || el.tagName === "TD" || el.tagName === "PRE") {
            candidates.push(el);
        }
    }

    /**
     * Initialize readability data for each candidate. This is a quick pass
     * that shouldn't take too long.
    **/
    for(i = 0, il = candidates.length; i < il; i++) {
        var candidate = candidates[i];
        var score = this._getScore(candidate);
        candidate.__readability = {"contentScore": score};

        // Add a point for the paragraph itself as a base.
        score += 1;

        // Add points for any commas within this paragraph
        score += this._getCharCount(candidate);

        // For every 100 characters in this paragraph, add another point. Up to 3 points.
        score += Math.min(Math.floor(this._getInnerText(candidate).length / 100), 3);

        candidate.__readability.contentScore = score;
    }

    /**
     * Loop through all candidates and find the best one.
     * This is the meat of the entire algorithm.
     *
     * In this loop, we're doing things like checking the link density of
     * the candidate's parent, looking for siblings, giving boosts to candidates
     * that have ancestors with certain classnames, etc.
    **/
    for(i = 0, il = candidates.length; i < il; i++) {
        var candidate = candidates[i];
        parent = candidate.parentNode;
        var grandparent = parent ? parent.parentNode : null;
        var score = candidate.__readability.contentScore;

        // If the candidate's parent is null, it's already been removed.
        if (!parent) continue;

        // Give a boost to the parent when it's a div.
        if (parent.tagName === "DIV") {
            if(!parent.__readability) {
                parent.__readability = {"contentScore": 0};
                candidates.push(parent);
            }
            parent.__readability.contentScore += score;
        }

        // Give a boost to the grandparent when it's a div.
        if (grandparent && grandparent.tagName === "DIV") {
            if(!grandparent.__readability) {
                grandparent.__readability = {"contentScore": 0};
                candidates.push(grandparent);
            }
            grandparent.__readability.contentScore += score;
        }
    }

    /**
     * After we've gone through the candidates, look for the one with the highest
     * score.
    **/
    for(i = 0, il = candidates.length; i < il; i++) {
        var candidate = candidates[i];

        if(!candidate.__readability) {
            continue;
        }

        // Scale the final candidates score based on link density. Good content
        // should have a relatively low link density (5% or less) and be mostly
        // unaffected by this operation.
        var score = candidate.__readability.contentScore * (1 - this._getLinkDensity(candidate));
        candidate.__readability.contentScore = score;

        if(!topCandidate || score > topCandidate.__readability.contentScore) {
            topCandidate = candidate;
        }
    }

    /**
     * If we still have no top candidate, find the one with the highest score
     * before we scaled it for link density.
    **/
    if (topCandidate === null || topCandidate.tagName === "BODY" || topCandidate.tagName === "HTML") {
        var secondTopCandidate = null;
        for (i = 0, il = candidates.length; i < il; i++) {
            var candidate = candidates[i];
            if (candidate.__readability) {
                if (!secondTopCandidate || candidate.__readability.contentScore > secondTopCandidate.__readability.contentScore) {
                    secondTopCandidate = candidate;
                }
            }
        }
        topCandidate = secondTopCandidate;
    }

    if (topCandidate) {
        articleContainer = this._doc.createElement("DIV");
        // It's possible that the top candidate is the page's body tag,
        // which would make it an ancestor of all the other candidates.
        // We can't just clone the candidate because all the other candidates
        // will be children of it.
        // Instead, we copy the attributes and innerHTML.
        if (topCandidate.tagName === "BODY") {
            // Copy the body's attributes to the new div
            for (i = 0, il = topCandidate.attributes.length; i < il; i++) {
                articleContainer.setAttribute(topCandidate.attributes[i].name, topCandidate.attributes[i].value);
            }
            articleContainer.innerHTML = topCandidate.innerHTML;
        } else {
            articleContainer.appendChild(topCandidate.cloneNode(true));
        }

        // It may be the case that the top candidate is a div with a high score
        // that is a parent of other candidates. In this case, we need to find
        // them and move them into the new div.
        var children = topCandidate.children;
        for (i = 0, il = children.length; i < il; i++) {
            var child = children[i];
            if (child.__readability && child.__readability.contentScore > 0) {
                articleContainer.appendChild(child.cloneNode(true));
            }
        }
    }

    return articleContainer;
  },

  /**
   * Now that we have the top candidate, look through its siblings for content
   * that might also be related. Things like preambles, content split by ads
   * that we removed, etc.
   *
   * @param Element
   * @return void
  **/
  _getArticleContent: function(topCandidate) {
    var articleContent = this._doc.createElement("DIV");
    if (topCandidate)
      articleContent.innerHTML = topCandidate.innerHTML;

    var siblingScoreThreshold = Math.max(10, topCandidate.__readability.contentScore * 0.2);
    var siblingNodes = topCandidate.parentNode.childNodes;


    for (var i = 0, il = siblingNodes.length; i < il; i++) {
      var sibling = siblingNodes[i];
      var append = false;

      this._log("Looking at sibling node:", sibling, (sibling.__readability ? ("with score " + sibling.__readability.contentScore) : ""));
      this._log("Sibling has score", (sibling.__readability ? sibling.__readability.contentScore : "Unknown"));

      if (sibling === topCandidate) {
        append = true;
      }

      var contentBonus = 0;
      // Give a bonus if sibling nodes and top candidates have the same class name
      if (sibling.className === topCandidate.className && topCandidate.className !== "") {
        contentBonus += topCandidate.__readability.contentScore * 0.2;
      }

      if (sibling.__readability && (sibling.__readability.contentScore + contentBonus) >= siblingScoreThreshold) {
        append = true;
      }

      if (sibling.nodeName === "P") {
        var linkDensity = this._getLinkDensity(sibling);
        var nodeContent = this._getInnerText(sibling);
        var nodeLength = nodeContent.length;

        if (nodeLength > 80 && linkDensity < 0.25) {
          append = true;
        } else if (nodeLength < 80 && nodeLength > 0 && linkDensity === 0 && nodeContent.search(/\.( |$)/) !== -1) {
          append = true;
        }
      }

      if (append) {
        this._log("Appending node:", sibling);

        var nodeToAppend = null;
        if (sibling.nodeName !== "DIV" && sibling.nodeName !== "P") {
          /* We have a node that isn't a common block level element, like a form or something. Create a div and stick it in there so we don't textFie the content. */
          this._log("Wrapping non-block node in div:", sibling);
          nodeToAppend = this._doc.createElement("DIV");
          try {
            nodeToAppend.id = sibling.id;
            nodeToAppend.innerHTML = sibling.innerHTML;
          } catch (ex) {
            this._log("Could not innerHTML the node:", ex);
            nodeToAppend = sibling.cloneNode(true);
          }
        } else {
          nodeToAppend = sibling.cloneNode(true);
        }

        // To ensure a node does not interfere with readability styles,
        // remove its classnames.
        nodeToAppend.className = "";

        /* Add the node to the passed in articleContent and ترتیب it. */
        articleContent.appendChild(nodeToAppend);
      }
    }

    return articleContent;
  },

  _getScore: function(node) {
    var score = 0;
    switch(node.tagName) {
      case "DIV":
        score += 5;
        break;

      case "PRE":
      case "TD":
      case "BLOCKQUOTE":
        score += 3;
        break;

      case "ADDRESS":
      case "OL":
      case "UL":
      case "DL":
      case "DD":
      case "DT":
      case "LI":
      case "FORM":
        score -= 3;
        break;

      case "H1":
      case "H2":
      case "H3":
      case "H4":
      case "H5":
      case "H6":
      case "TH":
        score -= 5;
        break;
    }
    score += this._getWeight(node);
    return score;
  },

  /**
   * Parses an element and returns the readability score.
   *
   * @param Element
   * @return number
  **/
  _parse: function(elem) {
    if (typeof elem === "undefined") {
      elem = this._doc.body;
    }

    var page = elem.cloneNode(true);
    var articleContent = this._findArticleContainer(page);
    if (!articleContent) {
      this._log("Could not find article container!");
      return null;
    }
    this._log("Found article container: ", articleContent);

    var articleTitle = this._getArticleTitle();
    this._log("Found article title: " + articleTitle);

    var articleByline = this._getArticleByline();
    this._log("Found article byline: " + articleByline);

    var articleDir = this._getArticleDirection();
    this._log("Found article direction: " + articleDir);

    var articleSiteName = this._getArticleSiteName();
    this._log("Found article site name: " + articleSiteName);

    var readability = this;
    var postProcess = function(articleContent) {
      readability._postProcessContent(articleContent);

      return {
        title: articleTitle,
        byline: articleByline,
        dir: articleDir,
        siteName: articleSiteName,
        content: readability._serializer(articleContent)
      };
    };

    var prepArticle = function(articleContent) {
      readability._cleanStyles(articleContent);
      readability._cleanHeaders(articleContent);

      // Do these cleanups in the inverse order that they appear in the source.
      readability._cleanConditionally(articleContent, "form");
      readability._cleanConditionally(articleContent, "table");
      readability._cleanConditionally(articleContent, "ul");
      readability._cleanConditionally(articleContent, "div");

      // We'll be dividing text into paragraphs, so remove paragraphs that are just a <br>
      Array.prototype.forEach.call(articleContent.getElementsByTagName("p"), function(p) {
        var innerHTML = p.innerHTML;

        // If the paragraph has no content but a <br> tag, remove it.
        if (p.children.length === 0 && innerHTML.length < 5 && innerHTML.toLowerCase() === "<br>") {
          p.parentNode.removeChild(p);
        }
      });

      // Remove any divs that look like non-content, once we've done
      // the general div cleanup above.
      var divs = articleContent.getElementsByTagName("div");
      Array.prototype.forEach.call(divs, function(div) {
        var p = div.getElementsByTagName("p");
        if (p.length === 0 && div.textContent.length < 100 && div.getElementsByTagName("img").length > 1) {
          div.parentNode.removeChild(div);
        }
      });
      return articleContent;
    };
    articleContent = prepArticle(articleContent);

    this._articleTitle = articleTitle;
    this._articleByline = articleByline;
    this._articleDir = articleDir;
    this._articleSiteName = articleSiteName;

    return postProcess(articleContent);
  },

  _getArticleByline: function() {
    var byline = this._doc.querySelector("*[rel=author]");
    if (byline) {
      return byline.textContent.trim();
    }
    // Search for a byline in the article metadata.
    var bylineMeta = this._doc.querySelector("meta[name='author']");
    if (bylineMeta) {
      return bylineMeta.getAttribute("content").trim();
    }
    return null;
  },

  _getArticleDirection: function() {
    var dir = this._doc.querySelector("*[dir]");
    if (dir) {
      return dir.getAttribute("dir");
    }
    return null;
  },

  _getArticleSiteName: function() {
    var siteName = this._doc.querySelector("meta[property='og:site_name']");
    if (siteName) {
      return siteName.getAttribute("content");
    }
    return null;
  }
};

export { Readability }; 