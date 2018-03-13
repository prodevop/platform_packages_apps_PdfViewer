"use strict";

let pdfDoc = null;
let pageRendering = false;
let renderPending = false;
let renderPendingLazy = false;
const canvas = document.getElementById('content');
let zoomLevel = 100;
let textLayerDiv = document.getElementById("text");
const zoomLevels = [50, 75, 100, 125, 150];
let renderTask = null;
let textLayerRenderTask = null;

let newPageNumber = 0;
let newZoomLevel = 0;
let useRender;

const cache = [];
const maxCached = 6;

function maybeRenderNextPage() {
    if (renderPending) {
        pageRendering = false;
        renderPending = false;
        renderPage(channel.getPage(), renderPendingLazy, false);
        return true;
    }
    return false;
}

function renderPage(pageNumber, lazy, prerender) {
    pageRendering = true;
    useRender = !prerender;

    function handleRenderingError(error) {
        console.log("error: " + error);

        pageRendering = false;
        maybeRenderNextPage();
    }

    function doPrerender() {
        if (useRender) {
            if (!maybeRenderNextPage() && pageNumber + 1 <= pdfDoc.numPages) {
                renderPage(pageNumber + 1, false, true);
            }
            if (!maybeRenderNextPage() && pageNumber - 1 > 0) {
                renderPage(pageNumber - 1, false, true);
            }
        }
    }

    newPageNumber = pageNumber;
    newZoomLevel = zoomLevels[channel.getZoomLevel()];
    console.log("page: " + pageNumber + ", zoom: " + newZoomLevel + ", prerender: " + prerender);
    for (let i = 0; i < cache.length; i++) {
        let cached = cache[i];
        if (cached.pageNumber == pageNumber && cached.zoomLevel == newZoomLevel) {
            if (useRender) {
                cache.splice(i, 1);
                cache.push(cached);

                canvas.height = cached.canvas.height;
                canvas.width = cached.canvas.width;
                canvas.style.height = cached.canvas.style.height;
                canvas.style.width = cached.canvas.style.width;
                const context = canvas.getContext("2d", { alpha: false });
                context.drawImage(cached.canvas, 0, 0);

                textLayerDiv.replaceWith(cached.textLayerDiv);
                textLayerDiv = cached.textLayerDiv;
            }

            pageRendering = false;
            doPrerender();
            return;
        }
    }

    pdfDoc.getPage(pageNumber).then(function(page) {
        const newCanvas = document.createElement("canvas");
        const viewport = page.getViewport(newZoomLevel / 100)
        const ratio = window.devicePixelRatio;
        newCanvas.height = viewport.height * ratio;
        newCanvas.width = viewport.width * ratio;
        newCanvas.style.height = viewport.height + "px";
        newCanvas.style.width = viewport.width + "px";
        const newContext = newCanvas.getContext("2d", { alpha: false });
        newContext.scale(ratio, ratio);

        if (useRender) {
            if (newZoomLevel != zoomLevel) {
                canvas.style.height = viewport.height + "px";
                canvas.style.width = viewport.width + "px";
            }
            zoomLevel = newZoomLevel;
        }

        renderTask = page.render({
            canvasContext: newContext,
            viewport: viewport
        });

        renderTask.then(function() {
            if (maybeRenderNextPage()) {
                return;
            }

            let rendered = false;
            function render() {
                if (!useRender || rendered) {
                    return;
                }
                canvas.height = newCanvas.height;
                canvas.width = newCanvas.width;
                canvas.style.height = newCanvas.style.height;
                canvas.style.width = newCanvas.style.width;
                const context = canvas.getContext("2d", { alpha: false });
                context.drawImage(newCanvas, 0, 0);
                rendered = true;
            }
            render();

            page.getTextContent().then(function(textContent) {
                if (maybeRenderNextPage()) {
                    return;
                }
                render();

                const textLayerFrag = document.createDocumentFragment();
                textLayerRenderTask = PDFJS.renderTextLayer({
                    textContent: textContent,
                    container: textLayerFrag,
                    viewport: viewport
                });
                textLayerRenderTask.promise.then(function() {
                    render();

                    const newTextLayerDiv = textLayerDiv.cloneNode();
                    newTextLayerDiv.style.height = newCanvas.style.height;
                    newTextLayerDiv.style.width = newCanvas.style.width;
                    if (useRender) {
                        textLayerDiv.replaceWith(newTextLayerDiv);
                        textLayerDiv = newTextLayerDiv;
                    }

                    newTextLayerDiv.appendChild(textLayerFrag);
                    if (cache.length == maxCached) {
                        cache.shift()
                    }
                    cache.push({
                        pageNumber: pageNumber,
                        zoomLevel: newZoomLevel,
                        canvas: newCanvas,
                        textLayerDiv: newTextLayerDiv
                    });
                    pageRendering = false;
                    doPrerender();
                }).catch(handleRenderingError);
            }).catch(handleRenderingError);
        }).catch(handleRenderingError);
    });
}

function onRenderPage(lazy) {
    if (pageRendering) {
        if (newPageNumber == channel.getPage() && newZoomLevel == zoomLevels[channel.getZoomLevel()]) {
            useRender = true;
            return;
        }

        renderPending = true;
        renderPendingLazy = lazy;
        if (renderTask !== null) {
            renderTask.cancel();
            renderTask = null;
        }
        if (textLayerRenderTask !== null) {
            textLayerRenderTask.cancel();
            textLayerRenderTask = null;
        }
    } else {
        renderPage(channel.getPage(), lazy, false);
    }
}

PDFJS.getDocument("https://localhost/placeholder.pdf").then(function(newDoc) {
    pdfDoc = newDoc;
    channel.setNumPages(pdfDoc.numPages);
    pdfDoc.getMetadata().then(function(data) {
        channel.setDocumentProperties(JSON.stringify(data.info, null, 2));
    });
    renderPage(channel.getPage(), false, false);
});
