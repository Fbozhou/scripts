// ==UserScript==
// @name         gooboo自动学习
// @namespace    gooboo自动学习
// @version      1.0.0
// @description  gooboo自动学习，根据不同学科进行适配
// @author       fbz
// @match        https://gityxs.github.io/gooboo/
// @icon         https://www.google.com/s2/favicons?sz=64&domain=github.io
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const app = {
        observer: null,
    }

    function checkIsInSchool(mutationList, observer) {
        for (const mutation of mutationList) {
            if (!mutation.type === "childList") { continue }
            if (!mutation.addedNodes.length > 0) { continue }
            const mainWrap = mutation.addedNodes[0]
            console.log(mutation.addedNodes[0])
            const schoolTarget = mainWrap.querySelector(`a[href="#school"]`)
            if (!schoolTarget) { continue }
            const cardList = mainWrap.querySelectAll('.v-card')

            for (const card of cardList) {
                const title = card.querySelector('.v-card__title')
                title.append(createButton('自动做题'))

            }
        }
    }

    function createButton(text) {
        const template = document.createElement('template')
        template.innerHTML = `<button type="button" class="v-btn v-btn--is-elevated v-btn--has-bg theme--light v-size--default primary" aria-haspopup="true" aria-expanded="false"><span class="v-btn__content">${text}</span></button>`
        return template.content.cloneNode(true)
    }

    var targetNode = document.querySelector(".v-main__wrap");
    var observerOptions = {
        childList: true, // 观察目标子节点的变化，是否有添加或者删除
    };

    app.observer = new MutationObserver(checkIsInSchool);
    app.observer.observe(targetNode, observerOptions);
})();
