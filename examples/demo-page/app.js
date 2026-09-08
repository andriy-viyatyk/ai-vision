import { createRemoteProxy, helpSearch as searchHelp, resolveCall } from "../../dist/core/index.js";
import { createElements, highlightElement } from "../../dist/dom/index.js";
import { expose } from "../../dist/remote/index.js";

const elementDeclarations = [
    { name: "filter-text", purpose: "Filter tasks by title or tag.", where: "Task toolbar" },
    { name: "filter-status", purpose: "Choose all, open, or done tasks.", where: "Task toolbar" },
    { name: "add-item", purpose: "Add a new task and optional tag.", where: "Task form" },
    { name: "item-list", purpose: "The currently visible task items.", where: "Task list" },
    { name: "clear-done", purpose: "Remove every completed task.", where: "Task header" },
];

const state = { filterText: "", filterStatus: "all", nextId: 4 };

function makeItem(id, title, done, tag) {
    const item = { id, title, done, tag: tag || "general" };
    Object.defineProperty(item, "aiVision", {
        enumerable: false,
        value: {
            kind: "DemoItem",
            summary: "One task item with a title, completion state, and tag.",
            members: [
                { name: "id", kind: "property", summary: "Stable numeric task identifier." },
                { name: "title", kind: "property", summary: "Task title." },
                { name: "done", kind: "property", summary: "Whether the task is complete." },
                { name: "tag", kind: "property", summary: "Short grouping label." },
            ],
            summarize: () => ({ id: item.id, title: item.title, done: item.done, tag: item.tag }),
        },
    });
    return item;
}

const items = [
    makeItem(1, "Read the object model", true, "learn"),
    makeItem(2, "Try a writable property", false, "demo"),
    makeItem(3, "Point at a control", false, "ui"),
];

Object.defineProperty(items, "aiVision", {
    enumerable: false,
    value: {
        kind: "DemoItems",
        summary: "The task collection; index it with items[0] or items[\"1\"].",
        members: [],
        index: key => typeof key === "number"
            ? items[key]
            : items.find(item => String(item.id) === key),
        summarize: () => items.map(item => item.aiVision.summarize()),
    },
});

const model = {
    items,
    addItem(title, tag) {
        const item = makeItem(state.nextId++, String(title), false, tag);
        model.items.push(item);
        render();
        return item;
    },
    toggleItem(id) {
        const item = model.items.find(candidate => candidate.id === Number(id));
        if (!item) return null;
        item.done = !item.done;
        render();
        return item;
    },
    clearDone() {
        const before = model.items.length;
        model.items.splice(0, model.items.length, ...model.items.filter(item => !item.done));
        render();
        return before - model.items.length;
    },
    helpSearch(query, limit) {
        return searchHelp(model, String(query), limit);
    },
};

Object.defineProperties(model, {
    filterText: {
        enumerable: true,
        get: () => state.filterText,
        set: value => { state.filterText = String(value ?? ""); render(); },
    },
    filterStatus: {
        enumerable: true,
        get: () => state.filterStatus,
        set: value => {
            const next = String(value ?? "all");
            state.filterStatus = ["all", "open", "done"].includes(next) ? next : "all";
            render();
        },
    },
});

const elementApi = createElements(elementDeclarations, highlightElement);

model.aiVision = {
    kind: "DemoApp",
    summary: "A small task list with filters, mutations, and screen controls.",
    overview: "Try items[0].title, set filterText with value, or call addItem with args.",
    help: "This demo is an agent-facing task model. Read items to inspect tasks, use filterText and filterStatus to change the view, and call addItem, toggleItem, or clearDone to mutate it. Use elements to inspect controls and highlight(name, message) to point at one.",
    members: [
        { name: "filterText", kind: "property", summary: "Text included in a task title or tag filter.", writable: true },
        { name: "filterStatus", kind: "property", summary: "Task status filter: all, open, or done.", writable: true },
        { name: "items", kind: "property", summary: "Indexable task collection.", node: true },
        { name: "addItem", kind: "method", signature: "addItem(title, tag?)", summary: "Add an open task." },
        { name: "toggleItem", kind: "method", signature: "toggleItem(id)", summary: "Toggle one task's completion state." },
        { name: "clearDone", kind: "method", signature: "clearDone()", summary: "Remove completed tasks." },
        { name: "helpSearch", kind: "method", signature: "helpSearch(query, limit?)", summary: "Find a member or control by purpose." },
        ...elementApi.members,
    ],
    elements: elementDeclarations,
    provide: name => elementApi.provide(name),
    summarize: () => ({
        filterText: model.filterText,
        filterStatus: model.filterStatus,
        visibleItems: visibleItems().length,
        totalItems: model.items.length,
    }),
};

function visibleItems() {
    const text = model.filterText.toLowerCase();
    return model.items.filter(item => {
        const matchesText = !text || `${item.title} ${item.tag}`.toLowerCase().includes(text);
        const matchesStatus = model.filterStatus === "all"
            || (model.filterStatus === "done" && item.done)
            || (model.filterStatus === "open" && !item.done);
        return matchesText && matchesStatus;
    });
}

function render() {
    document.querySelector("#filter-text").value = model.filterText;
    document.querySelector("#filter-status").value = model.filterStatus;
    const list = document.querySelector("[data-name=\"item-list\"]");
    list.replaceChildren();
    const visible = visibleItems();
    if (!visible.length) {
        const empty = document.createElement("li");
        empty.className = "empty";
        empty.textContent = "No tasks match the current filters.";
        list.append(empty);
        return;
    }
    for (const item of visible) {
        const row = document.createElement("li");
        row.className = `item${item.done ? " done" : ""}`;
        const toggle = document.createElement("button");
        toggle.className = "item-toggle";
        toggle.type = "button";
        toggle.textContent = item.done ? "Undo" : "Done";
        toggle.addEventListener("click", () => model.toggleItem(item.id));
        const title = document.createElement("span");
        title.className = "item-title";
        title.textContent = item.title;
        const tag = document.createElement("span");
        tag.className = "item-tag";
        tag.textContent = `#${item.tag}`;
        row.append(toggle, title, tag);
        list.append(row);
    }
}

document.querySelector("#filter-text").addEventListener("input", event => {
    model.filterText = event.target.value;
});
document.querySelector("#filter-status").addEventListener("change", event => {
    model.filterStatus = event.target.value;
});
document.querySelector("#clear-done").addEventListener("click", () => model.clearDone());
document.querySelector("#add-form").addEventListener("submit", event => {
    event.preventDefault();
    const title = document.querySelector("#add-title");
    const tag = document.querySelector("#add-tag");
    if (title.value.trim()) model.addItem(title.value.trim(), tag.value.trim() || undefined);
    title.value = "";
    tag.value = "";
    title.focus();
});

const remote = expose(model);
const proxy = createRemoteProxy(remote.describe(), request => remote.handle(request));
window.aiVisionDemo = { model, remote, proxy };

function parseOptionalJson(text, label) {
    if (!text.trim()) return undefined;
    try {
        return JSON.parse(text);
    } catch (error) {
        throw new Error(`${label} must be valid JSON: ${error.message}`);
    }
}

async function runCall() {
    const path = document.querySelector("#call-path").value;
    const argsText = document.querySelector("#call-args").value;
    const valueText = document.querySelector("#call-value").value;
    const resultOutput = document.querySelector("#call-result");
    const hintOutput = document.querySelector("#call-hint");
    try {
        const args = parseOptionalJson(argsText, "args");
        if (args !== undefined && !Array.isArray(args)) throw new Error("args must be a JSON array.");
        const value = parseOptionalJson(valueText, "value");
        const answer = await resolveCall(proxy, {
            path,
            ...(args !== undefined ? { args } : {}),
            ...(value !== undefined ? { value } : {}),
        });
        resultOutput.textContent = JSON.stringify(answer.error ? { error: answer.error } : answer.result, null, 2);
        hintOutput.textContent = answer.hint?.text ?? "(no hint for this result)";
    } catch (error) {
        resultOutput.textContent = JSON.stringify({ error: error.message }, null, 2);
        hintOutput.textContent = "(call was not sent)";
    }
}

document.querySelector("#run-call").addEventListener("click", runCall);
for (const button of document.querySelectorAll("[data-example]")) {
    button.addEventListener("click", () => {
        document.querySelector("#call-path").value = button.dataset.example;
        document.querySelector("#call-args").value = button.dataset.args;
        document.querySelector("#call-value").value = "";
        void runCall();
    });
}

render();
void runCall();
