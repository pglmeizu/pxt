namespace pxt.blocks {
    export interface ComposableMutation {
        // Set to save mutations. Should return an XML element
        mutationToDom(mutationElement: Element): Element;
        // Set to restore mutations from save
        domToMutation(savedElement: Element): void;
    }

    export function appendMutation(block: Blockly.Block, mutation: ComposableMutation) {
        const b = block as MutatingBlock;
        
        const oldMTD = b.mutationToDom;
        const oldDTM = b.domToMutation;

        b.mutationToDom = () => {
            const el = oldMTD ? oldMTD() : document.createElement("mutation");
            return mutation.mutationToDom(el);
        };

        b.domToMutation = saved => {
            if (oldDTM) {
                oldDTM(saved);
            }
            mutation.domToMutation(saved);
        }
    }

    export function initVariableArgsBlock(b: B.Block, handlerArgs: pxt.blocks.HandlerArg[]) {
        let currentlyVisible = 0;
        let actuallyVisible = 0;

        let i = b.appendDummyInput();

        let updateShape = () => {
            if (currentlyVisible === actuallyVisible) {
                return;
            }

            if (currentlyVisible > actuallyVisible) {
                const diff = currentlyVisible - actuallyVisible;
                for (let j = 0; j < diff; j++) {
                    const arg = handlerArgs[actuallyVisible + j];
                    i.insertFieldAt(i.fieldRow.length - 1, new Blockly.FieldVariable(arg.name), "HANDLER_" + arg.name);
                }
            }
            else {
                let diff = actuallyVisible - currentlyVisible;
                for (let j = 0; j < diff; j++) {
                    const arg = handlerArgs[actuallyVisible - j - 1];
                    i.removeField("HANDLER_" + arg.name);
                }
            }

            if (currentlyVisible >= handlerArgs.length) {
                i.removeField("_HANDLER_ADD");
            }
            else if (actuallyVisible >= handlerArgs.length) {
                addPlusButton();
            }

            actuallyVisible = currentlyVisible;
        };

        Blockly.Extensions.apply('inline-svgs', b, false);
        addPlusButton();

        appendMutation(b, {
            mutationToDom: (el: Element) => {
                el.setAttribute("numArgs", currentlyVisible.toString());
    
                for (let j = 0; j < currentlyVisible; j++) {
                    let varName = b.getFieldValue("HANDLER_" + handlerArgs[j].name);
                    el.setAttribute("arg" + j, varName);
                }
    
                return el;
            },
            domToMutation: (saved: Element) => {
                let numArgs = parseInt(saved.getAttribute("numargs"));
                currentlyVisible = Math.min(isNaN(numArgs) ? 0 : numArgs, handlerArgs.length);
    
                updateShape();
    
                for (let j = 0; j < currentlyVisible; j++) {
                    let varName = saved.getAttribute("arg" + j);
                    b.setFieldValue(varName, "HANDLER_" + handlerArgs[j].name);
                }
            }
        });

        function addPlusButton() {
            i.appendField(new Blockly.FieldImage((b as any).ADD_IMAGE_DATAURI, 24, 24, false, lf("Add argument"),
                () => {
                    currentlyVisible = Math.min(currentlyVisible + 1, handlerArgs.length);
                    updateShape();
                }), "_HANDLER_ADD");
        }
    }

    export function initExpandableBlock(b: Blockly.Block, def: pxtc.ParsedBlockDef, comp: BlockCompileInfo) {
        // Add underscores before input names to prevent clashes with the ones added
        // by BlocklyLoader. The underscore makes it an invalid JS identifier
        const buttonAddName = "__add_button";
        const buttonRemName = "__rem_button";
        const attributeName = "_expanded";

        const optionNames = def.parameters.map(p => p.name);
        const totalOptions = def.parameters.length;
        let visibleOptions = 0;

        Blockly.Extensions.apply('inline-svgs', b, false);
        addButton(buttonRemName, (b as any).REMOVE_IMAGE_DATAURI, lf("Hide optional arguments"), -1);
        addButton(buttonAddName, (b as any).ADD_IMAGE_DATAURI, lf("Reveal optional arguments"), 1);

        let inputsInitialized = false;
        const setInitialVisibility = () => {            
            if (!inputsInitialized && b.rendered) {
                inputsInitialized = true;
                updateShape(0, true);
                b.render();

                // We don't need to anything once the dom is initialized, so clean up
                b.workspace.removeChangeListener(setInitialVisibility);
            }
        }

        // Blockly only lets you hide an input once it is rendered, so we can't
        // hide the inputs in init() or domToMutation(). This will get called
        // immediately after the block is rendered but there is still a momentary
        // flicker in the toolbox while the block hides the additional inputs
        (b as any).setOnChange(setInitialVisibility);

        appendMutation(b, {
            mutationToDom: (el: Element) => {
                el.setAttribute(attributeName, visibleOptions.toString());
                return el;
            },
            domToMutation: (saved: Element) => {
                if (saved.hasAttribute(attributeName)) {
                    const val = parseInt(saved.getAttribute(attributeName));
                    if (!isNaN(val)) {
                        updateShape(val, true);
                    }
                }
            }
        });
        
        // Set skipRender to true if the block is still initializing. Otherwise
        // the inputs will render before their shadow blocks are created and
        // leave behind annoying artifacts
        function updateShape(delta: number, skipRender = false) {
            const newValue = Math.min(Math.max(visibleOptions + delta, 0), totalOptions);
            if (!skipRender && newValue === visibleOptions) return;

            visibleOptions = newValue;

            let optIndex = 0
            for (let i = 0; i < b.inputList.length; i++) {
                const input = b.inputList[i];
                if (Util.startsWith(input.name, "_optional_label_")) {
                    setInputVisible(input, optIndex < visibleOptions);
                }
                else if (Util.startsWith(input.name, "_optional_field_") || optionNames.indexOf(input.name) !== -1) {
                    const visible = optIndex < visibleOptions;
                    if (visible != input.isVisible()) {
                        setInputVisible(input, visible);
                        if (visible && input.connection && !(input.connection as any).isConnected()) {
                            // FIXME: Could probably be smarter here, right now this does not respect
                            // any options passed to the child block. Need to factor that out of BlocklyLoader
                            const param = comp.definitionNameToParam[def.parameters[optIndex].name];
                            const shadowId = param.shadowBlockId || shadowBlockForType(param.type);
                            if (shadowId) {
                                const nb = b.workspace.newBlock(shadowId);
                                nb.setShadow(true);
                                nb.initSvg();
                                input.connection.connect(nb.outputConnection);
                                nb.render();
                            }
                        }
                    }
                    ++optIndex;
                }
            }

            setButton(buttonAddName, visibleOptions !== totalOptions);
            setButton(buttonRemName, visibleOptions !== 0);
            if (!skipRender) b.render();
        }

        function addButton(name: string, uri: string, alt: string, delta: number) {
            b.appendDummyInput(name)
                .appendField(new Blockly.FieldImage(uri, 24, 24, false, alt, () => updateShape(delta)))
        }

        function setButton(name: string, visible: boolean) {
            b.inputList.forEach(i => {
                if (i.name === name) setInputVisible(i, visible);
            });
        }

        function setInputVisible(input: Blockly.Input, visible: boolean) {
            // If the block isn't rendered, Blockly will crash
            if (b.rendered) {
                input.setVisible(visible);
            }
        }
    }

    function shadowBlockForType(type: string) {
        switch (type) {
            case "number": return "math_number";
            case "boolean": return "logic_boolean" 
            case "string": return "text";
        }

        if (isArrayType(type)) {
            return "lists_create_with";
        }

        return undefined;
    }
}