'use strict';

function _interopDefault (ex) { return (ex && (typeof ex === 'object') && 'default' in ex) ? ex['default'] : ex; }

var CssNodeExtract = _interopDefault(require('css-node-extract'));
var fs = _interopDefault(require('fs'));
var glob = _interopDefault(require('glob'));
var path = _interopDefault(require('path'));
var postcssSyntax = _interopDefault(require('postcss-scss'));
var cleanImportUrl = _interopDefault(require('node-sass-filter-importer/dist/lib/clean-import-url'));
var extractImportFilters = _interopDefault(require('node-sass-filter-importer/dist/lib/extract-import-filters'));
var FilterImporter = _interopDefault(require('node-sass-filter-importer/dist/lib/filter-importer'));
var GlobImporter = _interopDefault(require('node-sass-glob-importer/dist/GlobImporter'));
var PackageImporter = _interopDefault(require('node-sass-package-importer/dist/PackageImporter'));
var SelectorImporter = _interopDefault(require('node-sass-selector-importer/dist/SelectorImporter'));

/**
 * Default options.
 *
 * @type {Object}
 */
var defaultOptions = {
  cwd: process.cwd(),
  includePaths: [process.cwd()],
  extensions: [".scss", ".sass"],
  packageKeys: ["sass", "scss", "style", "css", "main.sass", "main.scss", "main.style", "main.css", "main"],
  prefix: "~",
  disableWarnings: false,
  disableImportOnce: false
};

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

/**
 * Selector specific imports, filter imports, module importing,
 * globbing support and import files only once.
 */

var MagicImporter = function () {
  /**
   * @param {Object} options - Configuration options.
   */
  function MagicImporter() {
    var options = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};

    _classCallCheck(this, MagicImporter);

    /** @type {Object} */
    this.options = Object.assign({}, defaultOptions, options);
    /** @type {Array} */
    this.store = [];
  }

  /**
   * Find the absolute URL for a given relative URL.
   *
   * @param {String} url
   *   Import url from node-sass.
   * @return {String}
   *   Absolute import url.
   */


  _createClass(MagicImporter, [{
    key: 'getAbsoluteUrl',
    value: function getAbsoluteUrl(url) {
      var _this = this;

      var absoluteUrl = url;
      if (!path.isAbsolute(url)) {
        this.options.includePaths.some(function (includePath) {
          var globMatch = glob.sync(path.join(includePath, path.parse(url).dir, '?(_)' + path.parse(url).name + '@(' + _this.options.extensions.join('|') + ')'));

          if (globMatch.length) {
            absoluteUrl = globMatch[0];
            return true;
          }
          return false;
        });
      }
      return absoluteUrl;
    }

    /**
     * Add an URL to the store of imported URLs.
     *
     * @param {String} cleanUrl
     *   Cleaned up import url from node-sass.
     */

  }, {
    key: 'storeAdd',
    value: function storeAdd(cleanUrl) {
      var absoluteUrl = this.getAbsoluteUrl(cleanUrl);
      if (!this.store.includes(absoluteUrl)) this.store.push(absoluteUrl);
    }

    /**
     * Check if an URL is in store, add it if is not and it has no filters.
     *
     * @param {String} cleanUrl
     *   Cleaned up import url from node-sass.
     * @param {Boolean} hasFilters
     *   Does the URL have filters or not.
     * @return {boolean}
     *   Returns true if the URL has no filters and is already stored.
     */

  }, {
    key: 'isInStore',
    value: function isInStore(cleanUrl) {
      var hasFilters = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : false;

      var absoluteUrl = this.getAbsoluteUrl(cleanUrl);

      if (!hasFilters && this.store.includes(absoluteUrl)) return true;

      if (hasFilters && this.store.includes(absoluteUrl)) {
        if (!this.options.disableWarnings) {
          // eslint-disable-next-line no-console
          console.warn('Warning: double import of file "' + absoluteUrl + '".');
        }
        return false;
      }

      return false;
    }

    /**
     * Synchronously resolve the path to a node-sass import url.
     *
     * @param {String} url
     *   Import url from node-sass.
     * @return {String}
     *   Importer object or null.
     */

  }, {
    key: 'resolveSync',
    value: function resolveSync(url) {
      var _this2 = this;

      var data = null;
      var resolvedUrl = cleanImportUrl(url);

      // Parse url and eventually extract filters.
      var filterNames = extractImportFilters(url);

      // Parse url and eventually extract selector filters.
      var selectorImporter = new SelectorImporter(this.options);
      var selectorFilters = selectorImporter.parseUrl(url).selectorFilters || [];
      var hasFilters = filterNames.length || selectorFilters.length;

      // Try to resolve glob pattern url.
      var globImporter = new GlobImporter(this.options);
      var globFiles = globImporter.resolveFilePathsSync(resolvedUrl);
      if (globFiles.length) {
        return { contents: globFiles.map(function (globUrl) {
            if (!_this2.isInStore(globUrl, hasFilters) || _this2.options.disableImportOnce) {
              if (!hasFilters) _this2.storeAdd(globUrl);
              return fs.readFileSync(globUrl, { encoding: 'utf8' });
            }
            if (!hasFilters) _this2.storeAdd(globUrl);
            return '';
          }).join('\n') };
      }

      // Try to resolve a module url.
      var packageImporter = new PackageImporter(this.options);
      var packageImportData = packageImporter.resolveSync(resolvedUrl);
      if (packageImportData) {
        resolvedUrl = packageImportData.file;
        data = { file: resolvedUrl };
      }

      // If the file is already stored and should not be loaded,
      // prevent node-sass from importing the file again.
      if (this.isInStore(resolvedUrl, hasFilters) && !this.options.disableImportOnce) {
        return {
          file: '',
          contents: ''
        };
      }

      if (!hasFilters) this.storeAdd(resolvedUrl);

      // Filter.
      var filteredContents = void 0;
      // @TODO: This is ugly, maybe refactor.
      if (selectorFilters.length) {
        filteredContents = selectorImporter.extractSelectors(resolvedUrl, selectorFilters);
      }
      if (filterNames.length) {
        if (filteredContents) {
          filteredContents = CssNodeExtract.processSync({
            css: filteredContents,
            filterNames: filterNames,
            postcssSyntax: postcssSyntax
          });
        } else {
          var filterImporter = new FilterImporter(this.options);
          filteredContents = filterImporter.extractFilters(resolvedUrl, filterNames);
        }
      }
      if (filteredContents) {
        data = {
          file: resolvedUrl,
          contents: filteredContents
        };
      }

      return data;
    }

    /**
     * Asynchronously resolve the path to a node-sass import url.
     *
     * @param {string} url
     *   Import url from node-sass.
     * @return {Promise}
     *   Promise for importer object or null.
     */

  }, {
    key: 'resolve',
    value: function resolve(url) {
      var _this3 = this;

      return new Promise(function (promiseResolve) {
        promiseResolve(_this3.resolveSync(url));
      });
    }
  }]);

  return MagicImporter;
}();

module.exports = MagicImporter;
