import { Component } from "./index.js";
import { StreamInput } from "../stream/input.js";
import { GamepadState } from "../stream/gamepad.js";
import { StreamControllerButton } from "../api_bindings.js";

// @ts-ignore
declare const nipplejs: any;

export class VirtualGamepad implements Component {
    private streamInput: StreamInput;
    private virtualId: number = -1;
    private container: HTMLElement;

    // State
    private leftStick = { x: 0, y: 0 };
    private rightStick = { x: 0, y: 0 };
    private buttons = 0;
    private leftTrigger = 0;
    private rightTrigger = 0;



    private isEditMode = false;
    private layoutStorageKey = "moonlight-virtual-layout";
    private managers: any[] = [];

    constructor(streamInput: StreamInput) {
        this.streamInput = streamInput;
        this.container = document.createElement("div");
        this.container.id = "virtual-gamepad-overlay";
        this.container.style.position = "absolute";
        this.container.style.top = "0";
        this.container.style.left = "0";
        this.container.style.width = "100%";
        this.container.style.height = "100%";
        this.container.style.pointerEvents = "none"; // Let clicks pass through empty areas
        this.container.style.zIndex = "1000";
        this.container.style.display = "none"; // Hidden by default until enabled
    }

    mount(parent: HTMLElement) {
        parent.appendChild(this.container);
        this.initInterface();
    }

    unmount() {
        this.container.remove();
        this.managers.forEach(m => m.destroy());
    }

    public enable() {
        if (this.virtualId === -1) {
            this.virtualId = this.streamInput.registerVirtualGamepad();
        }
        this.container.style.display = "block";
    }

    public disable() {
        this.container.style.display = "none";
    }



    private updateState() {
        if (this.virtualId === -1) return;

        const state: GamepadState = {
            buttonFlags: this.buttons,
            leftTrigger: this.leftTrigger,
            rightTrigger: this.rightTrigger,
            leftStickX: this.leftStick.x,
            leftStickY: this.leftStick.y,
            rightStickX: this.rightStick.x,
            rightStickY: this.rightStick.y,
        };
        this.streamInput.sendVirtualGamepadState(this.virtualId, state);
    }

    private loadLayout(id: string, element: HTMLElement) {
        try {
            const layout = JSON.parse(localStorage.getItem(this.layoutStorageKey) || "{}");
            if (layout[id]) {
                const style = layout[id];
                element.style.top = style.top || "";
                element.style.bottom = style.bottom || "";
                element.style.left = style.left || "";
                element.style.right = style.right || "";
                element.style.transform = style.transform || "";
            }
        } catch (e) {
            console.error("Failed to load layout", e);
        }
    }

    private saveLayout(id: string, element: HTMLElement) {
        try {
            const layout = JSON.parse(localStorage.getItem(this.layoutStorageKey) || "{}");
            layout[id] = {
                top: element.style.top,
                bottom: element.style.bottom,
                left: element.style.left,
                right: element.style.right,
                transform: element.style.transform
            };
            localStorage.setItem(this.layoutStorageKey, JSON.stringify(layout));
        } catch (e) {
            console.error("Failed to save layout", e);
        }
    }

    private enableDrag(element: HTMLElement, id: string) {
        let isDragging = false;
        let startX = 0, startY = 0;
        let startLeft = 0, startTop = 0;

        const onTouchStart = (e: TouchEvent) => {
            if (!this.isEditMode) return;
            e.preventDefault();
            e.stopPropagation(); // Stop button press
            isDragging = true;
            const touch = e.touches[0];
            startX = touch.clientX;
            startY = touch.clientY;

            const rect = element.getBoundingClientRect();
            // We need to work with computed styles effectively, but for simplicity
            // we will switch to absolute top/left positioning upon drag start if not already
            // forcing a reset of bottom/right to auto might be needed

            // Simplified drag: just update left/top based on delta
            const parentRect = this.container.getBoundingClientRect();
            startLeft = rect.left - parentRect.left;
            startTop = rect.top - parentRect.top;

            element.style.right = "auto";
            element.style.bottom = "auto";
            element.style.left = `${startLeft}px`;
            element.style.top = `${startTop}px`;
            element.style.transform = "none"; // Clear transform during drag to simplify
        };

        const onTouchMove = (e: TouchEvent) => {
            if (!this.isEditMode || !isDragging) return;
            e.preventDefault();
            const touch = e.touches[0];
            const dx = touch.clientX - startX;
            const dy = touch.clientY - startY;

            element.style.left = `${startLeft + dx}px`;
            element.style.top = `${startTop + dy}px`;
        };

        const onTouchEnd = (e: TouchEvent) => {
            if (!this.isEditMode || !isDragging) return;
            isDragging = false;
            this.saveLayout(id, element);
        };

        element.addEventListener("touchstart", onTouchStart, { passive: false });
        element.addEventListener("touchmove", onTouchMove, { passive: false });
        element.addEventListener("touchend", onTouchEnd);
    }

    private initInterface() {
        // Edit Toggle Button
        const editBtn = document.createElement("div");
        editBtn.innerText = "✏️";
        editBtn.style.cssText = `
            position: absolute; top: 10px; left: 50%; transform: translateX(-50%);
            z-index: 2000; width: 40px; height: 40px; border-radius: 50%;
            background: rgba(0,0,0,0.5); color: white; display: flex;
            align-items: center; justify-content: center; pointer-events: auto; cursor: pointer;
        `;
        editBtn.onclick = () => {
            console.log("Edit Mode Toggled via Click");
            this.isEditMode = !this.isEditMode;
            editBtn.style.background = this.isEditMode ? "rgba(255, 0, 0, 0.8)" : "rgba(0,0,0,0.5)";
            this.container.style.border = this.isEditMode ? "4px solid red" : "none";
        };
        // Add explicit touch handler for better mobile responsiveness
        editBtn.ontouchend = (e) => {
            e.preventDefault(); // Prevent ghost click
            editBtn.onclick?.(e as any);
        };
        this.container.appendChild(editBtn);

        const commonButtonStyle = `
            position: absolute;
            background: rgba(255, 255, 255, 0.1);
            border: 2px solid rgba(255, 255, 255, 0.3);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            color: rgba(255, 255, 255, 0.9);
            font-family: sans-serif;
            font-weight: bold;
            user-select: none;
            pointer-events: auto;
            touch-action: none;
            opacity: 0.5;
        `;

        // --- D-Pad (Far Left) ---
        const dpadSize = 50;
        const dpadBaseLeft = 70;
        const dpadBaseBottom = 90;

        // Up
        this.createButton("btn-up", "↑", StreamControllerButton.BUTTON_UP, `${commonButtonStyle} width: ${dpadSize}px; height: ${dpadSize}px; bottom: ${dpadBaseBottom + 55}px; left: ${dpadBaseLeft}px; border-radius: 10px;`);
        // Down
        this.createButton("btn-down", "↓", StreamControllerButton.BUTTON_DOWN, `${commonButtonStyle} width: ${dpadSize}px; height: ${dpadSize}px; bottom: ${dpadBaseBottom - 55}px; left: ${dpadBaseLeft}px; border-radius: 10px;`);
        // Left
        this.createButton("btn-left", "←", StreamControllerButton.BUTTON_LEFT, `${commonButtonStyle} width: ${dpadSize}px; height: ${dpadSize}px; bottom: ${dpadBaseBottom}px; left: ${dpadBaseLeft - 55}px; border-radius: 10px;`);
        // Right
        this.createButton("btn-right", "→", StreamControllerButton.BUTTON_RIGHT, `${commonButtonStyle} width: ${dpadSize}px; height: ${dpadSize}px; bottom: ${dpadBaseBottom}px; left: ${dpadBaseLeft + 55}px; border-radius: 10px;`);


        // --- Left Joystick (Center Left) ---
        // Positioned right of the D-Pad
        const leftZone = document.createElement("div");
        leftZone.id = "vgamepad-left-zone";
        // left: dpadBaseLeft (70) + offset (~120) = 190
        leftZone.style.cssText = "position: absolute; bottom: 40px; left: 190px; width: 120px; height: 120px; pointer-events: auto;";
        this.loadLayout("stick-left", leftZone);
        this.enableDrag(leftZone, "stick-left");
        this.container.appendChild(leftZone);

        // --- Right Joystick (Center Right) ---
        // Positioned left of the ABXY
        const rightZone = document.createElement("div");
        rightZone.id = "vgamepad-right-zone";
        // right: abxyBaseRight (70) + offset (~120) = 190
        rightZone.style.cssText = "position: absolute; bottom: 40px; right: 190px; width: 120px; height: 120px; pointer-events: auto;";
        this.loadLayout("stick-right", rightZone);
        this.enableDrag(rightZone, "stick-right");
        this.container.appendChild(rightZone);

        // Init Nipple.js with smaller size (80)
        const leftManager = nipplejs.create({
            zone: leftZone,
            mode: 'static',
            position: { left: '50%', top: '50%' },
            color: 'white',
            size: 80
        });
        (leftManager as any).get(leftManager.ids[0]).ui.el.style.opacity = "0.5";

        leftManager.on('move', (evt: any, data: any) => {
            if (data && data.vector) {
                this.leftStick.x = data.vector.x;
                this.leftStick.y = -data.vector.y;
                this.updateState();
            }
        });
        leftManager.on('start', () => {
            (leftManager as any).get(leftManager.ids[0]).ui.el.style.opacity = "0.9";
        });
        leftManager.on('end', () => {
            this.leftStick.x = 0;
            this.leftStick.y = 0;
            this.updateState();
            (leftManager as any).get(leftManager.ids[0]).ui.el.style.opacity = "0.5";
        });

        const rightManager = nipplejs.create({
            zone: rightZone,
            mode: 'static',
            position: { left: '50%', top: '50%' },
            color: 'white',
            size: 80
        });
        (rightManager as any).get(rightManager.ids[0]).ui.el.style.opacity = "0.5";

        rightManager.on('move', (evt: any, data: any) => {
            if (data && data.vector) {
                this.rightStick.x = data.vector.x;
                this.rightStick.y = -data.vector.y;
                this.updateState();
            }
        });
        rightManager.on('start', () => {
            (rightManager as any).get(rightManager.ids[0]).ui.el.style.opacity = "0.9";
        });
        rightManager.on('end', () => {
            this.rightStick.x = 0;
            this.rightStick.y = 0;
            this.updateState();
            (rightManager as any).get(rightManager.ids[0]).ui.el.style.opacity = "0.5";
        });

        this.managers.push(leftManager, rightManager);

        // --- Action Buttons (ABXY) (Far Right) ---
        const btnSize = 55;
        const btnBaseRight = 70;
        const btnBaseBottom = 90;

        // A (Bottom)
        this.createButton("btn-a", "A", StreamControllerButton.BUTTON_A, `${commonButtonStyle} width: ${btnSize}px; height: ${btnSize}px; bottom: ${btnBaseBottom - 55}px; right: ${btnBaseRight}px; background: rgba(0, 255, 0, 0.15); border-color: rgba(0, 255, 0, 0.4);`);
        // B (Right)
        this.createButton("btn-b", "B", StreamControllerButton.BUTTON_B, `${commonButtonStyle} width: ${btnSize}px; height: ${btnSize}px; bottom: ${btnBaseBottom}px; right: ${btnBaseRight - 55}px; background: rgba(255, 0, 0, 0.15); border-color: rgba(255, 0, 0, 0.4);`);
        // X (Left)
        this.createButton("btn-x", "X", StreamControllerButton.BUTTON_X, `${commonButtonStyle} width: ${btnSize}px; height: ${btnSize}px; bottom: ${btnBaseBottom}px; right: ${btnBaseRight + 55}px; background: rgba(0, 0, 255, 0.15); border-color: rgba(0, 0, 255, 0.4);`);
        // Y (Top)
        this.createButton("btn-y", "Y", StreamControllerButton.BUTTON_Y, `${commonButtonStyle} width: ${btnSize}px; height: ${btnSize}px; bottom: ${btnBaseBottom + 55}px; right: ${btnBaseRight}px; background: rgba(255, 255, 0, 0.15); border-color: rgba(255, 255, 0, 0.4);`);

        // --- Center Buttons ---
        this.createButton("btn-select", "SELECT", StreamControllerButton.BUTTON_BACK, `${commonButtonStyle} width: 60px; height: 30px; border-radius: 15px; bottom: 20px; left: 50%; transform: translateX(-120%); font-size: 10px;`);
        this.createButton("btn-start", "START", StreamControllerButton.BUTTON_PLAY, `${commonButtonStyle} width: 60px; height: 30px; border-radius: 15px; bottom: 20px; left: 50%; transform: translateX(20%); font-size: 10px;`);

        // --- Shoulder Buttons ---
        // L1/R1 (Bumpers) - Positioned above D-Pad and ABXY
        this.createButton("btn-l1", "L1", StreamControllerButton.BUTTON_LB, `${commonButtonStyle} width: 100px; height: 40px; border-radius: 10px; top: 80px; left: 40px;`);
        this.createButton("btn-r1", "R1", StreamControllerButton.BUTTON_RB, `${commonButtonStyle} width: 100px; height: 40px; border-radius: 10px; top: 80px; right: 40px;`);

        // L2/R2 (Triggers) - Above L1/R1
        this.createTrigger("btn-l2", "L2", true, `${commonButtonStyle} width: 100px; height: 40px; border-radius: 10px; top: 30px; left: 40px;`);
        this.createTrigger("btn-r2", "R2", false, `${commonButtonStyle} width: 100px; height: 40px; border-radius: 10px; top: 30px; right: 40px;`);
    }

    private createButton(id: string, label: string, flag: number, cssText: string) {
        const btn = document.createElement("div");
        btn.innerText = label;
        btn.style.cssText = cssText;

        this.loadLayout(id, btn);

        const press = (e: TouchEvent | MouseEvent) => {
            if (this.isEditMode) return;
            this.buttons |= flag;
            btn.style.opacity = "0.9";
            this.updateState();
        };
        const release = (e: TouchEvent | MouseEvent) => {
            if (this.isEditMode) return;
            this.buttons &= ~flag;
            btn.style.opacity = "0.5";
            this.updateState();
        };

        btn.onmousedown = press;
        btn.onmouseup = release;
        btn.ontouchstart = (e) => {
            if (this.isEditMode) return; // Let dragging handler take over
            e.preventDefault();
            press(e);
        };
        btn.ontouchend = (e) => {
            if (this.isEditMode) return;
            e.preventDefault();
            release(e);
        };

        this.enableDrag(btn, id);
        this.container.appendChild(btn);
    }

    private createTrigger(id: string, label: string, isLeft: boolean, cssText: string) {
        const btn = document.createElement("div");
        btn.innerText = label;
        btn.style.cssText = cssText;

        this.loadLayout(id, btn);

        const press = (e: TouchEvent | MouseEvent) => {
            if (this.isEditMode) return;
            if (isLeft) this.leftTrigger = 255; else this.rightTrigger = 255;
            btn.style.opacity = "0.9";
            this.updateState();
        };
        const release = (e: TouchEvent | MouseEvent) => {
            if (this.isEditMode) return;
            if (isLeft) this.leftTrigger = 0; else this.rightTrigger = 0;
            btn.style.opacity = "0.5";
            this.updateState();
        };

        btn.onmousedown = press;
        btn.onmouseup = release;
        btn.ontouchstart = (e) => {
            if (this.isEditMode) return;
            e.preventDefault();
            press(e);
        };
        btn.ontouchend = (e) => {
            if (this.isEditMode) return;
            e.preventDefault();
            release(e);
        };

        this.enableDrag(btn, id);

        this.container.appendChild(btn);
    }
}
