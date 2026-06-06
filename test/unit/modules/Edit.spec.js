import TabulatorFull from '../../../src/js/core/TabulatorFull.js';
import Edit from '../../../src/js/modules/Edit/Edit.js';
import { DateTime } from "luxon";

describe("Edit module", () => {
	let table;
	
	// Helper function to create a table and wait for it to be built
	const setupTable = async (tableOptions = {}) => {
		document.body.innerHTML = '<div id="test-table"></div>';
		
		const defaultOptions = {
			data: [
				{ id: 1, name: "John", age: 25 },
				{ id: 2, name: "Jane", age: 30 },
				{ id: 3, name: "Bob", age: 35 }
			],
			columns: [
				{ title: "ID", field: "id" },
				{ title: "Name", field: "name", editor: "input" },
				{ title: "Age", field: "age", editor: "number" }
			]
		};
		
		// Create table with merged options
		const options = { ...defaultOptions, ...tableOptions };
		const newTable = new TabulatorFull("#test-table", options);
		
		// Wait for table to be built
		await new Promise(resolve => {
			newTable.on("tableBuilt", resolve);
		});
		
		return newTable;
	};
	
	beforeEach(async () => {
		table = await setupTable();
	});
	
	afterEach(() => {
		if(table) {
			table.destroy();
		}
	});
	
	it("should have edit module", () => {
		const edit = table.module("edit");
		expect(edit).toBeInstanceOf(Edit);
	});
	
	it("should have predefined editors", () => {
		// Check that various editors are defined
		const edit = table.module("edit");
		
		expect(edit.editors).toBeDefined();
		expect(typeof edit.editors.input).toBe("function");
		expect(typeof edit.editors.textarea).toBe("function");
		expect(typeof edit.editors.number).toBe("function");
	});
	
	it("should update cell values", async () => {
		// Get a cell
		const row = table.getRows()[0];
		const cell = row.getCell("name");
		
		// Initial value
		const initialValue = cell.getValue();
		expect(initialValue).toBe("John");
		
		// Update value and check it was changed
		const newValue = "Updated Name";
		cell.setValue(newValue);
		
		expect(cell.getValue()).toBe(newValue);
		expect(row.getData().name).toBe(newValue);
	});
	
	it("should emit cellEdited event when value changes", async () => {
		// Listen for the cellEdited event
		const editPromise = new Promise(resolve => {
			table.on("cellEdited", function(cell) {
				// Verify the changed cell
				expect(cell.getValue()).toBe("Updated via Event");
				expect(cell.getField()).toBe("name");
				resolve();
			});
		});
		
		// Change a cell value to trigger the event
		const cell = table.getRows()[0].getCell("name");
		cell.setValue("Updated via Event");
		
		// Wait for the event
		await editPromise;
	});
	
	it("should add editors to editor types object", () => {
		const edit = table.module("edit");
		const initialEditorCount = Object.keys(edit.editors).length;
		
		// Add a new editor
		const customEditor = function(cell, onRendered, success, cancel) {
			return document.createElement("input");
		};
		
		edit.editors.custom = customEditor;
		
		// Check the editor was added
		expect(Object.keys(edit.editors).length).toBe(initialEditorCount + 1);
		expect(edit.editors.custom).toBe(customEditor);
	});
	
	it("should track edited events", async () => {
		// Create a spy for the cellEdited event
		const cellEditedSpy = jest.fn();
		table.on("cellEdited", cellEditedSpy);
		
		// Change a cell value
		const cell = table.getRows()[0].getCell("name");
		cell.setValue("New Value");
		
		// Wait a bit for event processing
		await new Promise(resolve => setTimeout(resolve, 100));
		
		// Should have received the cellEdited event
		expect(cellEditedSpy).toHaveBeenCalled();
	});
});

describe("Edit module - date editors with 'x' (epoch milliseconds) format", () => {
	// 2021-05-10T00:00:00.000Z
	const EPOCH_MS = 1620604800000;

	let table;

	const buildTable = async (column) => {
		document.body.innerHTML = '<div id="test-table"></div>';
		table = new TabulatorFull("#test-table", {
			data: [{ id: 1, ts: EPOCH_MS }],
			columns: [{ title: "ID", field: "id" }, column],
		});
		await new Promise((resolve) => table.on("tableBuilt", resolve));
		return table;
	};

	// Opens the cell editor and returns its <input> element.
	const openEditor = () => {
		const cell = table.getRows()[0].getCell("ts");
		cell.edit();
		return { cell, input: cell.getElement().querySelector("input") };
	};

	// Sets the input value and submits the edit via the Enter key.
	const submit = (input, value) => {
		input.value = value;
		input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
	};

	beforeEach(() => {
		// The date/time editors resolve luxon from window.DateTime, while the
		// datetime editor resolves it via the dependency registry (window.luxon).
		window.DateTime = DateTime;
		window.luxon = { DateTime };
	});

	afterEach(() => {
		if (table) {
			table.destroy();
		}
		delete window.DateTime;
		delete window.luxon;
	});

	it("datetime editor parses an epoch-ms value into the input on open", async () => {
		await buildTable({ title: "TS", field: "ts", editor: "datetime", editorParams: { format: "x" } });

		const { input } = openEditor();
		const expected = DateTime.fromMillis(EPOCH_MS).toFormat("yyyy-MM-dd'T'HH:mm");
		expect(input.value).toBe(expected);
	});

	it("datetime editor saves the edited value back as epoch milliseconds", async () => {
		await buildTable({ title: "TS", field: "ts", editor: "datetime", editorParams: { format: "x" } });

		const { cell, input } = openEditor();
		submit(input, "2021-05-11T06:30");

		const expected = DateTime.fromISO("2021-05-11T06:30").toMillis();
		expect(cell.getValue()).toBe(expected);
		expect(typeof cell.getValue()).toBe("number");
	});

	it("date editor parses an epoch-ms value into the input on open", async () => {
		await buildTable({ title: "TS", field: "ts", editor: "date", editorParams: { format: "x" } });

		const { input } = openEditor();
		const expected = DateTime.fromMillis(EPOCH_MS).toFormat("yyyy-MM-dd");
		expect(input.value).toBe(expected);
	});

	it("date editor saves the edited value back as epoch milliseconds", async () => {
		await buildTable({ title: "TS", field: "ts", editor: "date", editorParams: { format: "x" } });

		const { cell, input } = openEditor();
		submit(input, "2021-05-11");

		const expected = DateTime.fromFormat("2021-05-11", "yyyy-MM-dd").toMillis();
		expect(cell.getValue()).toBe(expected);
		expect(typeof cell.getValue()).toBe("number");
	});

	it("time editor parses an epoch-ms value into the input on open", async () => {
		await buildTable({ title: "TS", field: "ts", editor: "time", editorParams: { format: "x" } });

		const { input } = openEditor();
		const expected = DateTime.fromMillis(EPOCH_MS).toFormat("HH:mm");
		expect(input.value).toBe(expected);
	});

	it("time editor saves the edited value back as epoch milliseconds", async () => {
		await buildTable({ title: "TS", field: "ts", editor: "time", editorParams: { format: "x" } });

		const { cell, input } = openEditor();
		submit(input, "10:30");

		expect(typeof cell.getValue()).toBe("number");
	});
});