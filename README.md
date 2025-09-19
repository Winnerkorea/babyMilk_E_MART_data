# 🛒 SSG Scraper v3

이 프로젝트는 [이마트 SSG](https://emart.ssg.com/disp/category.ssg?dispCtgId=6000213557) 카테고리 페이지에서
상품 **브랜드명, 상품명(title), URL, 이미지**를 수집하여 JSON과 이미지 파일로 저장하는 Puppeteer 기반 크롤러입니다.  
자동화 탐지 회피를 위해 `puppeteer-extra` + `stealth plugin`을 사용합니다.

---

## ✨ 기능
- Puppeteer + Stealth Plugin을 이용한 **봇 탐지 완화**
- 자동 스크롤(`autoScroll`)을 통한 무한 스크롤/지연 로딩 처리
- 상품 정보 추출
  - **브랜드명**:  
    `#ty_thmb_view > ul > li > div > a > div.mnemitem_tit > span.mnemitem_goods_brand`
  - **상품명(title)**:  
    `#ty_thmb_view > ul > li > div > a > div.mnemitem_tit > span.mnemitem_goods_tit`
  - **상품 URL**:  
    `#ty_thmb_view > ul > li > div > a`
  - **상품 이미지**:  
    `#ty_thmb_view > ul > li > div > a img`
- 이미지 로컬 저장 (파일명 = `title`)
- JSON 저장 (`result.json`)  
  - URL / Brand / Title / ImageUrl / ImageLocalPath 포함

---

## 📂 폴더 구조

```bash
output/
└── ssg_2025-09-19T10-30-00/
    ├── images/            # 다운로드된 상품 이미지
    └── result.json        # 크롤링 결과 메타데이터
