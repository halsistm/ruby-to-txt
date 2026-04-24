// ==========================================
// 設定：ここを書き換えるだけでカッコの種類を変更できます
var OPEN_B  = "《"; // 開始カッコ
var CLOSE_B = "》"; // 終了カッコ
// ==========================================
// 親文字が1文字 → モノルビ
// 親文字が2文字以上 → グループルビ
// ==========================================

Main();
function Main(){
    app.doScript("doMain()", ScriptLanguage.JAVASCRIPT, [], UndoModes.fastEntireScript);
}

// コピペ可能なアラートダイアログ
function showAlert(msg) {
    try {
        var dlg = app.dialogs.add({ name: "お知らせ", canCancel: false });
        var col = dlg.dialogColumns.add();
        col.dialogRows.add().staticTexts.add({ staticLabel: msg, minWidth: 320 });
        col.dialogRows.add().textEditboxes.add({ editContents: msg, minWidth: 320 });
        dlg.show();
        dlg.destroy();
    } catch (e) {
        alert(msg); // フォールバック
    }
}

function doMain(){
    if (app.documents.length === 0 || app.selection.length === 0) {
        showAlert("ルビを処理したいテキストを選択してから実行してください。");
        return;
    }

    var target = app.selection[0];
    if (!target.hasOwnProperty("findGrep")) {
        showAlert("テキストをテキストツールで選択してから実行してください。");
        return;
    }

    app.findGrepPreferences  = NothingEnum.nothing;
    app.changeGrepPreferences = NothingEnum.nothing;

    // 全パターンを一括検索: †親文字《ルビ》
    app.findGrepPreferences.findWhat =
        "†([^†" + OPEN_B + CLOSE_B + "\\r\\n]+?)" +
        OPEN_B +
        "([^" + OPEN_B + CLOSE_B + "\\r\\n]+?)" +
        CLOSE_B;

    var foundItems = target.findGrep();

    if (foundItems.length === 0) {
        app.findGrepPreferences  = NothingEnum.nothing;
        app.changeGrepPreferences = NothingEnum.nothing;
        return;
    }

    // =========================================================
    // 文末ルビ対策：
    // ストーリー末尾に仮スペースを挿入し、ルビ対象文字が
    // ストーリー最終文字にならないようにする。
    // =========================================================
    var story = null;
    try {
        story = target.parentStory;
    } catch (e) {}

    if (story) {
        story.insertionPoints.item(-1).contents = " ";
    }

    // 後ろから処理して位置ズレを防止
    for (var i = foundItems.length - 1; i >= 0; i--) {
        processRubyBlock(foundItems[i]);
    }

    // 仮スペースを削除
    if (story) {
        story.characters.item(-1).remove();
    }

    if (foundItems.length > 50) {
        app.activeDocument.recompose();
    }

    app.findGrepPreferences  = NothingEnum.nothing;
    app.changeGrepPreferences = NothingEnum.nothing;
}

function processRubyBlock(textObj) {
    try {
        var contentStr = textObj.contents;
        if (contentStr.charAt(0) !== "†") return;

        var rubyStartBracketIdx = contentStr.indexOf(OPEN_B);
        if (rubyStartBracketIdx === -1) return;

        var closeIdx = contentStr.indexOf(CLOSE_B);
        if (closeIdx === -1) return;

        // ルビ文字列（カッコの中身）
        var rubyStr = contentStr.substring(rubyStartBracketIdx + 1, closeIdx);

        // 親文字の範囲（†の次〜《の手前）
        var oyaRangeEndIdx = rubyStartBracketIdx - 1;
        if (oyaRangeEndIdx < 1) return;

        var oyaLength = oyaRangeEndIdx; // 親文字の文字数

        // =========================================================
        // バグ修正のポイント：
        // textObj 相対インデックスは、文末付近で textObj の境界が
        // 不安定になるため信頼できない。
        // ここでストーリー絶対インデックス（整数）を先に記録し、
        // 以降の操作はすべて story.characters の絶対位置で行う。
        // =========================================================
        var story = textObj.parentStory;

        // 各文字のストーリー絶対インデックスを整数として保存（ライブ参照ではない）
        var absIdxDagger       = textObj.characters.item(0).index;                   // †
        var absIdxOyaStart     = textObj.characters.item(1).index;                   // 親文字の先頭
        var absIdxOyaEnd       = textObj.characters.item(oyaRangeEndIdx).index;      // 親文字の末尾
        var absIdxBracketOpen  = textObj.characters.item(rubyStartBracketIdx).index; // 《
        var absIdxBracketClose = textObj.characters.item(closeIdx).index;            // 》

        // =========================================================
        // スペース区切りモード判定：
        // ルビ文字列に半角スペースがあり、スペース区切り数が
        // 親文字数と一致する場合 → 各文字に個別ルビ（モノルビ）
        // 一致しない場合 → グループルビにフォールバック
        // 例: †一色《いっ しき》 → モノルビ
        //     †二人《ふたり》   → グループルビ
        // =========================================================
        var rubyParts = rubyStr.split(" ");
        var isSpaceSep = rubyParts.length > 1 && rubyParts.length === oyaLength;

        // =========================================================
        // InDesign の仕様：perCharacterRuby をレンジ全体にセットし
        // ルビ文字列にスペースを含めると、InDesign がスペースを
        // 区切りとして各親文字に自動配分する。
        // → スペース区切りモード時はレンジにまとめてセットするだけでよい。
        // =========================================================
        var oyaRange = story.characters.itemByRange(absIdxOyaStart, absIdxOyaEnd);
        if (isSpaceSep) {
            // スペース入りルビ文字列をレンジ全体に perCharacterRuby でセット
            // InDesign がスペースを境界としてモノルビに自動配分する
            oyaRange.rubyString = rubyStr;
            oyaRange.rubyFlag   = true;
            oyaRange.rubyType   = RubyTypes.perCharacterRuby;
        } else {
            // グループルビ（親文字2文字以上）または単文字モノルビ
            var rubyType = (oyaLength === 1)
                ? RubyTypes.perCharacterRuby
                : RubyTypes.groupRuby;
            oyaRange.rubyString = rubyStr;
            oyaRange.rubyFlag   = true;
            oyaRange.rubyType   = rubyType;
        }

        // 後ろから削除（絶対インデックスを使用するためズレが発生しない）
        // Step1: 《ルビ》 を削除（文末側から先に削除）
        story.characters.itemByRange(absIdxBracketOpen, absIdxBracketClose).remove();
        // Step2: † を削除（Step1 より前方なので位置は変わらず有効）
        story.characters.item(absIdxDagger).remove();

    } catch (e) {
        // 個別エラーは無視して次へ
    }
}
