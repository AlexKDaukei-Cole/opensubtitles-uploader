'use strict';

const Interface = {

    // USERINTERACTION: switch between light/dark themes
    switchTheme: () => {
        // switch stored setting on click
        localStorage.theme = !localStorage || (localStorage && localStorage.theme === 'dark') ? 'light' : 'dark';
        // reload to let loadTheme do the job
        Misc.saveState();
        win.reload();
    },

    // USERINTERACTION: on "browse" button click, invoke hidden input action
    browse: (type) => {
        console.info('Opening File Browser');
        document.querySelector('#' + type + '-file-path-hidden').click();
    },

    // USERINTERACTION: adds video file to main interface after analyzis
    add_video: (file, multidrop) => {
        let info = {};

        // show spinner early if no video is there, we'll check for duplicate later
        if(!$('#moviehash').val()) {
            $('#main-video-shadow').show().css('opacity', '1');
        }

        // extract info form video file
        OS.hash(file).then((data) => {
            // cache results
            info = {
                moviefilename: path.basename(file),
                moviebytesize: data.moviebytesize,
                moviehash: data.moviehash,
                quality: Files.extractQuality(path.basename(file))
            };
            if (info.moviehash === $('#moviehash').val()) {
                throw 'already_present';
            } else {
                console.info('Adding new video!');
                // show spinner
                $('#main-video-shadow').show().css('opacity', '1');

                // try to find imdb match in OS api
                return OS.identify(file);
            }
        }).then((data) => {
            // cache results
            if (data.metadata && data.metadata.imdbid) {
                info.metadata = data.metadata;
                info.imdbid = data.metadata.imdbid;
            }
            // get mediainfo data on the file
            return Files.mediainfo(file);
        }).then((metadata) => {
            // fill visible Interface with cached data
            Interface.reset('video');

            // 1st column with OS data
            $('#video-file-path').val(file);
            $('#moviefilename').val(info.moviefilename);
            $('#moviebytesize').val(info.moviebytesize);
            $('#moviehash').val(info.moviehash);
            if (info.quality && info.quality.match(/720|1080/i)) {
                $('#highdefinition').prop('checked', true);
            }

            // 2nd column with MediaInfo data
            $('#movietimems').val(metadata.duration ? metadata.duration.toString().split('.')[0] : undefined);
            $('#moviefps').val(metadata.frame_rate);
            $('#movieframes').val(metadata.frame_count);

            // extra: HD is hard to autodetect, check again with MediaInfo data
            $('#highdefinition').prop('checked', (metadata.height >= 720 || (metadata.width >= 1280 && metadata.height >= 536))); // cut cinebar can be down to 536px

            // check IMBB data
            $('.search-imdb i').addClass('fa-circle-o-notch fa-spin').removeClass('fa-search'); // display spinner for little imdb button
            if (info.metadata && info.imdbid) {
                // OS.identify gave title & imdb id
                let title = '';
                const d = info.metadata;

                if (d.episode_title) {
                    title += d.title + ' S' + Misc.pad(d.season) + 'E' + Misc.pad(d.episode) + ', ' + d.episode_title + ' (' + d.year + ')';
                    Misc.TmpMetadata = {
                        episode: d.episode,
                        season: d.season,
                        title: d.title
                    };
                } else {
                    title += d.title + ' (' + d.year + ')';
                }

                Interface.imdbFromSearch(info.imdbid, title);
            } else {
                // OS.identify gave imdb only, grab title from API
                if (info.imdbid) {
                    OsActions.imdbMetadata(info.imdbid);
                } else {
                    // not found with OS.identify, trying harder
                    Misc.isSearchingImage = true;
                    OS.login().then((res) => {
                        Interface.updateUserInfo(res.userinfo);
                        return OS.api.GuessMovieFromString(res.token, [info.moviefilename]);
                    }).then((res) => {
                        if (res.data && res.data[info.moviefilename] && res.data[info.moviefilename].BestGuess) {
                            // OS.api.GuessMovieFromString got info!
                            const d = res.data[info.moviefilename].BestGuess;
                            const id = d.IMDBEpisode || d.IDMovieIMDB;
                            OsActions.imdbMetadata(id);
                        } else {                            
                            // nothing was found, remove spin and leave field empty
                            throw 'nothing was found by GuessMovieFromString';
                        }
                    }).catch((error) => {
                        console.error(error);
                        $('.search-imdb i').addClass('fa-search').removeClass('fa-circle-o-notch fa-spin');
                        $('#main-video-shadow').css('opacity', '0').hide();
                    });
                }
            }

            // auto-detect matching subtitle if the user didn't drop both video+text files
            if (!multidrop) {
                // Hack RegExp, required for special chars
                RegExp.escape = (s) => String(s).replace(/[\\\^$*+?.()|\[\]{}]/g, '\\$&');
                // read directory video is from, looking for sub
                fs.readdir(path.dirname(file), (err, f) => {
                    if (err) {
                        return;
                    }

                    for (let i = 0; i < f.length; i++) {
                        if (f[i].slice(0, f[i].length - path.extname(f[i]).length).match(RegExp.escape(path.basename(file).slice(0, path.basename(file).length - path.extname(file).length))) && Files.detectFileType(f[i]) === 'subtitle') {
                            // if match found, load it :) 
                            console.info('Matching subtitle detected');

                            const existing = $('#subtitle-file-path').val();

                            if (existing && (path.basename(existing) !== f[i])) {
                                // modal to select which subtitle to load
                                Interface.modal(i18n.__('Replace the currently loaded file with the detected one: %s', '<span class="modal-filename">'+f[i]+'</span>'), 'yes', 'no');

                                // on click 'yes'
                                $('.modal-yes').on('click', (e) => Interface.add_subtitle(path.join(path.dirname(file), f[i]), true));
                                // on click 'no'
                                $('.modal-no').on('click', (e) => Interface.reset('modal'));
                            } else {
                                Interface.add_subtitle(path.join(path.dirname(file), f[i]), true);
                            }
                            break;
                        }
                    }
                });
            }

            if (!Misc.isSearchingImage) {
                // we're done here, spinner can go rest
                $('#main-video-shadow').css('opacity', '0').hide();
            }
        }).catch((err) => {
            // hide spinner
            $('#main-video-shadow').css('opacity', '0').hide();

            // is it because file was already analyzed?
            if (err === 'already_present') {
                return;
            }

            // something terrible happened during the info extraction process
            Interface.reset('video');

            // notify the error to user
            if ((err.body && err.body.match(/503/)) || (err.toString().match(/503/)) || (err.code === 'ETIMEDOUT')) {
                Notify.snack(i18n.__('Video cannot be imported because OpenSubtitles could not be reached. Is it online?'), 4500);
            } else if ((err.body && err.body.match(/506/i)) || (err.toString().match(/506/))) {
                Notify.snack(i18n.__('OpenSubtitles is under maintenance, please retry in a few hours'), 4500);
            } else {
                Notify.snack(i18n.__('Unknown OpenSubtitles related error, please retry later or report the issue'), 4500);
            }
            console.error(err);
        });
    },

    // AUTO: displays logged-in user
    logged: () => {
        // base infos
        const username = localStorage.os_user;
        const isFresh = localStorage.os_refreshed ? (parseInt(localStorage.os_refreshed) + 604800000 > Date.now()) : false;

        if (username) {
            $('#login-username').val(username);
        }

        if (isFresh) {
            // display username
            $('#logged .username').text(username);

            // update userinfo
            Interface.updateUserInfo({
                UserRank: localStorage.os_rank,
                IDUser: localStorage.os_id
            });

            // display logged div
            $('#not-logged').hide();
            $('#logged').show();

            console.info('Logged in! (as %s - ID:%s)', username, localStorage.os_id);
        } else {
            OsActions.refreshInfo();
        }
    },

    // USERINTERACTION: log out
    logout: () => {
        console.info('Logged out!');
        $('#login-username').val(localStorage.os_user);
        $('#login-password').val('');
        localStorage.removeItem('os_user');
        localStorage.removeItem('os_pw');
        localStorage.removeItem('os_rank');
        localStorage.removeItem('os_id');
        localStorage.removeItem('os_refreshed');
        $('#logged').hide();
        $('#not-logged').show();
    },

    animate: (el, cl, duration) => {
        $(el).addClass(cl).delay(duration).queue(() => $(el).removeClass(cl).dequeue());
    },

    // USERINTERACTION: adds subtitle file to main interface after analyzis
    add_subtitle: (file, multidrop) => {
        console.info('Adding new subtitle!');
        Interface.reset('subtitle');
        $('#subtitle-file-path').val(file);
        $('#subfilename').val(path.basename(file));
        // grab md5 hash
        OS.md5(file).then((data) => $('#subhash').val(data));
        // try to detect lang of the subtitle
        Files.detectSubLang();
        // try to detect auto-translated
        Files.detectMachineTranslated();
        // try to detect sound description
        Files.detectSoundDescriptions();
        // try to detect sound description
        Files.detectForeignOnly();

        // auto-detect matching video if the user didn't drop both video+text files
        if (!multidrop) {
            // Hack RegExp, required for special chars
            RegExp.escape = (s) => String(s).replace(/[\\\^$*+?.()|\[\]{}]/g, '\\$&');
            // SxE matching
            let m1 = (a) => {
                let s = a.match(/S(\d{1,2})/i);
                let e = a.match(/E(\d{2})/ig);
                return (s && e) ? {
                    s: parseInt(s[0].replace('S','')), 
                    e: parseInt(e[0].replace('E',''))
                } : null;
            };
            let m2 = (a) => {
                let x = a.match(/(\d\d?)x(\d\d?)/i);
                return x ? {
                    s: parseInt(x[0].match(/(\d\d?)x/i)[0].replace('x','')), 
                    e: parseInt(x[0].match(/(x(\d\d?))/i)[0].replace('x', ''))
                } : null;
            };

            // read directory video is from, looking for sub
            fs.readdir(path.dirname(file), (err, f) => {
                if (err) {
                    return;
                }

                for (let i = 0; i < f.length; i++) {
                    let _found = f[i];
                    if (Files.detectFileType(_found) !== 'video') continue;
                    console.debug('Auto-detect 1/3: "%s" is a video file', _found);

                    let _fext = path.extname(_found);
                    let _fn = _found.slice(0, _found.length - _fext.length);
                    
                    let _dropped = path.basename(file);
                    let _dext = path.extname(_dropped);
                    let _dn = _dropped.slice(0, _dropped.length - (_dext.length + 10));

                    if(!RegExp.escape(_fn).match(RegExp.escape(_dn))) continue;
                    console.debug('Auto-detect 2/3: matching file names: "%s", "%s"', _fn, _dn);

                    let _fm1 = m1(_found);
                    let _fm2 = m2(_found);
                    let _dm1 = m1(_dropped);
                    let _dm2 = m2(_dropped);
                    
                    let notashow = false;
                    let sxe = (() => {
                        if ((_fm1 || _fm2) && (_dm1 || _dm2)) {
                           if (
                               (((_fm1 && _fm1.s) || (_fm2 && _fm2.s)) == ((_dm1 && _dm1.s) || (_dm2 && _dm2.s))) && 
                               (((_fm1 && _fm1.e) || (_fm2 && _fm2.e)) == ((_dm1 && _dm1.e) || (_dm2 && _dm2.e)))
                           ) {
                               console.debug('Auto-detect 3/3: matching SxE tag:', _fm1, _fm2, _dm1, _dm2);
                               return true;
                           } else {
                               return false;
                           }
                        } else {
                            notashow = true;
                            console.debug('Auto-detect 3/3: no SxE tag found, video file probably is not a show');
                            return true;
                        }
                    })();
                    
                    if (!sxe) continue;

                    // if match found, load it :) 
                    console.info('Matching video detected, 3/3 steps completed!', {
                        step1: `'${_found}' is a video file (extension: ${_fext})`,
                        step2: `'${_fn}' filename matches at least '${_dn}'`,
                        step3: `'${_found}' ${notashow ? 'is not a show (no SxE tag)' : 'has the same SxE tag as the subtitle'}`,
                    });

                    const existing = $('#video-file-path').val();

                    if (existing && (path.basename(existing) !== f[i])) {
                        // modal to select which subtitle to load
                        Interface.modal(i18n.__('Replace the currently loaded file with the detected one: %s', '<span class="modal-filename">'+f[i]+'</span>'), 'yes', 'no');

                        // on click 'yes'
                        $('.modal-yes').on('click', (e) => Interface.add_video(path.join(path.dirname(file), f[i]), true));
                        // on click 'no'
                        $('.modal-no').on('click', (e) => Interface.reset('modal'));
                    } else {
                        Interface.add_video(path.join(path.dirname(file), f[i]), true);
                    }

                    break;
                }
            });
        }
    },

    // AUTO or USERINTERACTION: resets the interface, erasing values
    reset: (type) => {
        if (type) {
            console.debug('Clear form:', type);
        }

        switch (type) {
        case 'video':
            $('#video-file-path').val('');
            $('#video-file-path-hidden').val('');
            $('#detected-title').text('');
            $('#moviefilename').val('');
            $('#moviehash').val('');
            $('#moviebytesize').val('');
            $('#imdbid').val('');
            $('#movieaka').val('');
            $('#moviereleasename').val('');
            $('#moviefps').val('');
            $('#movietimems').val('');
            $('#movieframes').val('');

            $('#highdefinition').prop('checked', false);
            $('#imdb-info').attr('title', '').hide();
            $('#main-video').css('border-color', '');
            if ($('#upload-popup').css('display') === 'block') {
                Interface.reset('modal');
            }
            $('#main-video-img').css('background-image', 'none').hide().css('opacity', '0');
            $('#main-video .input-file, #main-video .reset, #detected-title').removeClass('white-ph');
            $('#main-video-placeholder').css('background', 'transparent');
            $('#main-video-shadow').hide().css('opacity', '0');
            break;
        case 'subtitle':
            $('#subtitle-file-path').val('');
            $('#subtitle-file-path-hidden').val('');
            $('#subfilename').val('');
            $('#subhash').val('');
            $('#subauthorcomment').val('');
            $('#subtranslator').val('');

            $('#hearingimpaired').prop('checked', false);
            $('#automatictranslation').prop('checked', false);
            $('#foreignpartsonly').prop('checked', false);

            $('#sublanguageid').val('');
            $('#main-subtitle').css('border-color', '');
            if ($('#upload-popup').css('display') === 'block') {
                Interface.reset('modal');
            }
            Interface.restoreLocks();
            break;
        case 'search':
            $('#search-text').val('');
            $('#search-result').html('');
            break;
        case 'modal':
            $('#modal-content').html('');
            $('#modal-buttons > div').removeClass('left right').hide();
            $('#upload-popup').css('opacity', 0).hide();
            $('#modal-buttons .modal-open').attr('data-url', '');
            $('#button-upload i').removeClass('fa-check fa-quote-left fa-close').addClass('fa-cloud-upload');
            break;
        default:
            // blank sheet, remove everything
            Interface.reset('video');
            Interface.reset('subtitle');
            Interface.reset('modal');
            Interface.reset('search');
        }
    },

    // STARTUP or AUTO: restore the 'locks' settings
    restoreLocks: () => {
        const subauthorcomment = localStorage['lock-subauthorcomment'];
        const subtranslator = localStorage['lock-subtranslator'];
        const sublanguageid = localStorage['lock-sublanguageid'];

        if (subauthorcomment) {
            $('#subauthorcomment').val(subauthorcomment).prop('readonly', true);
            $('#lock-subauthorcomment').addClass('fa-lock').removeClass('fa-unlock');
        }
        if (subtranslator) {
            $('#subtranslator').val(subtranslator).prop('readonly', true);
            $('#lock-subtranslator').addClass('fa-lock').removeClass('fa-unlock');
        }
        if (sublanguageid) {
            $('#sublanguageid').val(sublanguageid).prop('disabled', true);
            $('#lock-sublanguageid').addClass('fa-lock').removeClass('fa-unlock');
        }
    },

    // NOTIFY: displays popup to user, with action buttons
    modal: (text, btright, btleft) => {
        // load the notification text
        $('#modal-content').html(text);
        // add buttons
        $('#modal-buttons .modal-' + btleft).addClass('left').show();
        $('#modal-buttons .modal-' + btright).addClass('right').show();
        // display built popup
        $('#upload-popup').show().css('opacity', 1);
    },

    // NOTIFY: show/hide "uploading" spinner
    spinner: (show) => {
        if (show) {
            $('#upload-modal').hide();
            $('#upload-popup').show().css('opacity', 1);
            $('#upload-spin').show();
        } else {
            $('#upload-spin').hide();
            $('#upload-popup').css('opacity', 0).hide();
            $('#upload-modal').show();
        }
    },

    // USERINTERACTION: open imdb search popup (actually using OS api)
    searchPopup: () => {
        console.debug('Opening IMDB search popup');
        // close popup on click elsewhere
        $(document).bind('mouseup', Interface.leavePopup);

        const begin_title = [];
        const clean_title = [];
        let count = 0;
        let toPush = 0;
        const title = Files.clearName($('#moviefilename').val()).split(' ');

        for (let t in title) {
            if (!title[t].match(/^(the|an|19\d{2}|20\d{2}|a|of|in)$/i)) {
                clean_title.push(title[t]);
                toPush++;
            }
        }
        for (let u in clean_title) {
            if (count < (toPush > 5 ? 4 : toPush - 1)) {
                begin_title.push(clean_title[u]);
                count++;
            }
        }
        $('#search-popup').show().css('opacity', 1);
        $('#search-text').val(begin_title.join(' '));
        $('#search-text').focus();
    },

    // USERINTERACTION: open settings popup
    settingsPopup: () => {
        console.debug('Opening settings');
        // close popup on click elsewhere
        $(document).bind('mouseup', Interface.leavePopup);

        $('#settings-popup').show().css('opacity', 1);
    },

    // USERINTERACTION or AUTO: close imdb search popup
    leavePopup: (e) => {
        if ($('#search-popup').is(':visible') && !$('#search').is(e.target) && $('#search').has(e.target).length === 0) {
            console.debug('Closing IMDB search popup');
            // hide popup
            $('#search-popup').css('opacity', 0).hide();
            $('#search-result').hide();
            // reset default popup view
            $('#search').css({
                height: '20px',
                top: 'calc(50% - 80px)'
            });
            Interface.reset('search');
            // remove the onclick event defined in searchPopup()
            $(document).unbind('mouseup', Interface.leavePopup);
        } else if ($('#settings-popup').is(':visible') && !$('#settings-content').is(e.target) && $('#settings-content').has(e.target).length === 0 && !$('#upload-modal').is(':visible')) {
            console.debug('Closing settings');
            // hide popup
            $('#settings-popup').css('opacity', 0).hide();
            // remove the onclick event defined in searchPopup()
            $(document).unbind('mouseup', Interface.leavePopup);
        }
    },

    // USERINTERACTION or AUTO: on click a result from imdb search popup, inject imdb id, tooltip text and close popup
    imdbFromSearch: (id, title, show) => {
        console.debug('Adding IMDB id to main form');

        // add leading 'tt'
        id = id > 9999999 ? id : 'tt' + id.toString().replace('tt', ''); // id over 9999999 is not imdb, but custom OS id

        // display the value
        $('#imdbid').val(id);
        $('#imdb-info').removeClass('warning fa-warning').addClass('fa-info-circle');
        $('#imdb-info').attr('title', 'IMDB: ' + title).attr('imdbid', id).show();
        $('#detected-title').text(title);

        // hide spinner for little imdb button, shown in add_video() and imdb udpate
        $('.search-imdb i').addClass('fa-search').removeClass('fa-circle-o-notch fa-spin');

        // display placeholder
        Misc.imageLookup(show || id).then(Interface.displayPlaceholder);

        // close popup
        Interface.leavePopup({});
    },

    // AUTO: displays the image found online
    displayPlaceholder: (uri) => {
        Misc.isSearchingImage = false;
        Misc.TmpMetadata = false;

        if (!uri) {
            $('#main-video-shadow').css('opacity', '0').hide();
            return;
        }

        console.info('Loading image', uri);

        // preload
        let img = new Image();
        img.src = uri;
        img.onload = () => {
            // inject
            $('#main-video-placeholder').css('background', '#333');
            $('#main-video-img').css('background-image', 'url('+uri+')').show().css('opacity', '0.7');
            $('#main-video .input-file, #main-video .reset, #detected-title').addClass('white-ph');
            // reset cache
            img = null;
            // hide spin
            $('#main-video-shadow').css('opacity', '0').hide();
        };
    },

    // STARTUP: checks imdbid field for manual changes, then verify if new ID is valid
    setupImdbFocus: () => {
        let imdbFocusVal = false;
        $('#imdbid')
            .focus((e) => imdbFocusVal = e.target.value) //on focus, cache previous value
            .focusout((e) => {
            // if new value is different, then a manual change was made
            if (e.target.value !== imdbFocusVal) {
                // invalidate cache
                imdbFocusVal = false;
                // check new value
                OsActions.imdbMetadata(e.target.value);
            }
        });
    },

    // USERINTERACTION: on 'lock icon' click, stores or cleans field value
    toggleSave: (el) => {
        const lockId = $(el).attr('id');
        const fieldId = lockId.substr(5);

        if (localStorage[lockId] !== undefined) {
            // if a value was stored
            $(el).addClass('fa-unlock').removeClass('fa-lock');
            document.getElementById(fieldId).removeAttribute('readonly');
            document.getElementById(fieldId).removeAttribute('disabled');
            localStorage.removeItem(lockId);
            console.debug('%s disabled', lockId);
        } else {
            // nothing was stored yet
            const val = $('#' + fieldId).val();
            if (val) { // sometimes val can be '' empty string
                $(el).addClass('fa-lock').removeClass('fa-unlock');
                document.getElementById(fieldId).setAttribute('readonly', true);
                document.getElementById(fieldId).setAttribute('disabled', true);
                localStorage[lockId] = val;
                console.debug('%s enabled, storing \'%s\'', lockId, localStorage[lockId]);
            }
        }
    },

    // AUTO: injects userinfo in the UI
    updateUserInfo: (userinfo) => {
        if (!userinfo) {
            return;
        }

        console.debug('Update user info', userinfo);

        localStorage.os_id = userinfo.IDUser;
        localStorage.os_rank = userinfo.UserRank;
        localStorage.os_refreshed = Date.now();

        if (userinfo.UserRank) {
            // update user rank
            $('#logged .icon-user').addClass('icon-' + userinfo.UserRank.replace(/\W/g, '-'));

            // display tooltip
            $('#logged .icon-user').prop('title', userinfo.UserRank.toUpperCase());
        }

        if (userinfo.IDUser) {
            // open os profile on click
            $('#logged .username').off('click');
            $('#logged .username').on('click', (e) => Misc.openExternal('https://www.opensubtitles.org/profile/iduser-' + userinfo.IDUser));
        }
    }
};