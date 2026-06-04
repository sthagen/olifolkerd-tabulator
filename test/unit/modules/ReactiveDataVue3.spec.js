/**
 * Reproduction test for GitHub issue #4212
 * https://github.com/tabulator-tables/tabulator/issues/4212
 *
 * "vue3 reactivity problem: .push() causes Tabulator data to be updated
 *  but does not update the array variable"
 *
 * When `reactiveData: true` is used together with a Vue 3 `reactive([])`
 * array, calling `.push()` (and the other mutating array methods) updates
 * the Tabulator display but leaves the underlying reactive array variable
 * unchanged, so the table and the array fall out of sync.
 *
 * Root cause (as noted by the reporter, relating to "recursion"):
 *   1. `watchData()` captures `this.origFuncs.push = data.push`. On a Vue 3
 *      reactive proxy, reading `data.push` returns Vue's *instrumented* push,
 *      not the native `Array.prototype.push`.
 *   2. `Object.defineProperty(this.data, "push", ...)` installs Tabulator's
 *      override on the raw array target behind the proxy.
 *   3. When the user calls `reactiveArray.push(x)`, Vue's instrumented push
 *      dispatches to `toRaw(arr).push`, which is Tabulator's override. The
 *      override calls `addRowActual` (table updates) and then invokes the
 *      captured `origFuncs.push` — which is Vue's instrumented push *again*.
 *      That re-enters Tabulator's override, but reactivity is now `blocked`,
 *      so the `if` branch is skipped and the *native* push is never executed.
 *
 * The net effect: the row is added to the table, but the reactive array is
 * never actually mutated.
 *
 * These tests assert the CORRECT (in-sync) behaviour, so they currently FAIL,
 * demonstrating the bug.
 */

import { reactive } from "vue";
import ReactiveData from "../../../src/js/modules/ReactiveData/ReactiveData";

describe("ReactiveData module with Vue 3 reactive arrays (issue #4212)", () => {
    /** @type {ReactiveData} */
    let reactiveData;
    let mockTable;
    let mockRowManager;

    beforeEach(() => {
        mockRowManager = {
            // addRowActual is what actually inserts a row into the table render
            addRowActual: jest.fn(),
            getRowFromDataObject: jest.fn(),
            reRenderInPosition: jest.fn(),
            refreshActiveData: jest.fn(),
        };

        mockTable = {
            rowManager: mockRowManager,
            modules: {},
            options: {
                reactiveData: true,
                dataTree: false,
                dataTreeChildField: "children",
            },
            eventBus: { subscribe: jest.fn() },
        };

        jest.spyOn(ReactiveData.prototype, "registerTableOption").mockImplementation(
            function (key, value) {
                this.table.options[key] = this.table.options[key] || value;
            }
        );
        jest.spyOn(ReactiveData.prototype, "subscribe").mockImplementation(() => {});

        reactiveData = new ReactiveData(mockTable);
    });

    afterEach(() => {
        jest.clearAllMocks();
        jest.restoreAllMocks();
    });

    it("keeps a Vue 3 reactive array in sync with the table when push() is called", () => {
        const data = reactive([{ id: 1, name: "John" }]);

        reactiveData.watchData(data);

        const newRow = { id: 2, name: "Bob" };
        data.push(newRow);

        // The table IS updated: addRowActual is called for the new row.
        expect(mockRowManager.addRowActual).toHaveBeenCalledWith(newRow, false);

        // The reactive array SHOULD also be updated, but with the bug it is not,
        // leaving the table and the array out of sync.
        expect(data).toHaveLength(2);
        expect(data[1]).toEqual(newRow);
    });

    it("keeps a Vue 3 reactive array in sync with the table when unshift() is called", () => {
        const data = reactive([{ id: 1, name: "John" }]);

        reactiveData.watchData(data);

        const newRow = { id: 0, name: "Alice" };
        data.unshift(newRow);

        expect(mockRowManager.addRowActual).toHaveBeenCalledWith(newRow, true);

        expect(data).toHaveLength(2);
        expect(data[0]).toEqual(newRow);
    });
});
